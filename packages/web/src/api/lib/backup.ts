import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { eq, lte, and, sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { s3, BUCKET } from "./s3";
import { newId } from "./ids";
import { driveConfigured, uploadToDrive } from "./backup-drive";
import { DEFAULT_AGENCY_SETTINGS, type AgencySettings } from "../database/schema";

/** Agency settings merged over defaults — local copy to avoid a middleware cycle. */
async function agencySettings(agencyId: string): Promise<AgencySettings> {
  const [agency] = await db
    .select()
    .from(schema.agencies)
    .where(eq(schema.agencies.id, agencyId))
    .limit(1);
  return { ...DEFAULT_AGENCY_SETTINGS, ...(agency?.settings ?? {}) };
}


/* --------------------------------------------------- AES-256-GCM encryption */

function key(): Buffer {
  const secret = process.env.BACKUP_ENCRYPT_KEY ?? process.env.BETTER_AUTH_SECRET ?? "matchhire-dev-key";
  return scryptSync(secret, "matchhire-backup-v1", 32);
}

export function encrypt(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decrypt(payload: Buffer): Buffer {
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]);
}

export function checksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/* -------------------------------------------------------------- backup tiers */

export type BackupTier = "daily" | "weekly" | "monthly" | "manual";

const ALL_TABLES = {
  agencies: schema.agencies,
  clients: schema.clients,
  jobDescriptions: schema.jobDescriptions,
  candidates: schema.candidates,
  cvJdMatches: schema.cvJdMatches,
  hrQuestions: schema.hrQuestions,
  interviewsHr: schema.interviewsHr,
  interviewsAi: schema.interviewsAi,
  techTemplates: schema.techTemplates,
  interviewsTechnical: schema.interviewsTechnical,
  placements: schema.placements,
  blacklistReasons: schema.blacklistReasons,
  candidateEvents: schema.candidateEvents,
  auditLogs: schema.auditLogs,
} as const;

export interface BackupResult {
  id: string;
  fileName: string;
  storageKey: string;
  sizeBytes: number;
  recordCount: number;
  checksum: string;
  durationSeconds: number;
}

/**
 * Snapshot the agency's data, gzip it, encrypt it with AES-256-GCM and store the
 * `.enc` artifact in object storage. Tier decides what is included:
 * daily/manual = live records, weekly = everything, monthly = hired only.
 */
export async function runBackup(
  agencyId: string,
  tier: BackupTier,
  triggeredBy?: string,
): Promise<BackupResult> {
  const startedAt = Date.now();
  const id = newId("bkp");
  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `Skillton_backup_${stamp}_${tier}.enc`;

  await db.insert(schema.backupLogs).values({
    id,
    backupType: tier,
    fileName,
    status: "in_progress",
    dbSnapshot: true,
    cvsIncluded: tier === "weekly",
    jdsIncluded: tier === "weekly",
    triggeredBy,
  });

  try {
    const snapshot: Record<string, unknown[]> = {};
    let recordCount = 0;

    for (const [name, table] of Object.entries(ALL_TABLES)) {
      const hasAgency = "agencyId" in table;
      const rows = hasAgency
        ? await db.select().from(table as never).where(eq((table as never as { agencyId: never }).agencyId, agencyId as never))
        : await db.select().from(table as never);

      let filtered = rows as Record<string, unknown>[];
      if (tier === "monthly" && name === "candidates") {
        filtered = filtered.filter((r) => r.retentionPolicy === "hired_permanent");
      }
      if (tier === "daily" && name === "auditLogs") {
        const cutoff = Date.now() - 30 * 86_400_000;
        filtered = filtered.filter((r) => (r.createdAt as Date)?.getTime?.() >= cutoff);
      }
      snapshot[name] = filtered;
      recordCount += filtered.length;
    }

    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        tier,
        agencyId,
        createdAt: new Date().toISOString(),
        tables: snapshot,
      }),
      "utf8",
    );

    const compressed = gzipSync(payload);
    const encrypted = encrypt(compressed);
    const sum = checksum(encrypted);
    const storageKey = `${agencyId}/backups/${tier}/${fileName}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
        Body: encrypted,
        ContentType: "application/octet-stream",
        Metadata: { checksum: sum, tier, records: String(recordCount) },
      }),
    );

    /* Mirror to Google Drive when the agency has connected an account. Object
       storage stays the restore source of truth, so a Drive failure downgrades
       the destination label instead of failing the whole backup. */
    let destination = "tigris";
    const settings = await agencySettings(agencyId);
    if (settings.backupProvider === "gdrive" && driveConfigured(settings)) {
      try {
        await uploadToDrive(settings, fileName, encrypted);
        destination = "tigris+gdrive";
      } catch (error) {
        destination = `tigris (drive failed: ${(error as Error).message.slice(0, 80)})`;
      }
    }

    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    await db
      .update(schema.backupLogs)
      .set({
        destination,
        status: "success",
        fileSizeBytes: encrypted.byteLength,
        storageKey,
        checksum: sum,
        recordCount,
        durationSeconds,
      })
      .where(eq(schema.backupLogs.id, id));

    return { id, fileName, storageKey, sizeBytes: encrypted.byteLength, recordCount, checksum: sum, durationSeconds };
  } catch (error) {
    await db
      .update(schema.backupLogs)
      .set({
        status: "failed",
        errorMessage: (error as Error).message.slice(0, 400),
        durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      })
      .where(eq(schema.backupLogs.id, id));
    throw error;
  }
}

/** Delete backup artifacts past their tier retention window. */
export async function pruneBackups(dailyDays: number, weeklyDays: number) {
  const rows = await db.select().from(schema.backupLogs).where(eq(schema.backupLogs.status, "success"));
  let removed = 0;
  for (const row of rows) {
    const ageDays = (Date.now() - row.createdAt.getTime()) / 86_400_000;
    const limit =
      row.backupType === "weekly" ? weeklyDays : row.backupType === "monthly" ? Infinity : dailyDays;
    if (ageDays > limit && row.storageKey) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: row.storageKey })).catch(() => null);
      await db.delete(schema.backupLogs).where(eq(schema.backupLogs.id, row.id));
      removed++;
    }
  }
  return removed;
}

/* ---------------------------------------------------------- retention rules */

export interface CleanupSummary {
  rule: string;
  affected: number;
  detail: string;
}

/**
 * Data retention & cleanup (PRD §6). Hired candidates are never touched.
 * PII is anonymized but match records, scores and interview summaries survive
 * for analytics.
 */
export async function runCleanup(agencyId: string, dryRun = false): Promise<CleanupSummary[]> {
  const summaries: CleanupSummary[] = [];
  const now = new Date();

  /* 1. Candidates whose deletion window elapsed → anonymize PII. */
  const due = await db
    .select()
    .from(schema.candidates)
    .where(
      and(
        eq(schema.candidates.agencyId, agencyId),
        lte(schema.candidates.deletionScheduledAt, now),
        sql`${schema.candidates.retentionPolicy} != 'hired_permanent'`,
        sql`${schema.candidates.anonymizedAt} is null`,
      ),
    );

  if (!dryRun) {
    for (const candidate of due) {
      await db
        .update(schema.candidates)
        .set({
          firstName: "Deleted",
          lastName: null,
          email: null,
          phone: null,
          cvText: null,
          cvVector: null,
          cvFilePath: null,
          headline: null,
          anonymizedAt: now,
          retentionPolicy: "standard",
          deletionScheduledAt: null,
        })
        .where(eq(schema.candidates.id, candidate.id));
    }
  }
  summaries.push({
    rule: "Rejected / expired candidates anonymized",
    affected: due.length,
    detail: "CV text, file reference and PII removed; scores and interview records preserved",
  });

  /* 2. Shortlisted but never interviewed for 90 days → move to rejected. */
  const staleCutoff = new Date(now.getTime() - 90 * 86_400_000);
  const stale = await db
    .select({ id: schema.candidates.id })
    .from(schema.candidates)
    .where(
      and(
        eq(schema.candidates.agencyId, agencyId),
        eq(schema.candidates.currentStatus, "shortlisted"),
        lte(schema.candidates.updatedAt, staleCutoff),
      ),
    );
  if (!dryRun) {
    for (const row of stale) {
      await db
        .update(schema.candidates)
        .set({
          currentStatus: "rejected",
          retentionPolicy: "marked_for_deletion",
          deletionScheduledAt: new Date(now.getTime() + 30 * 86_400_000),
          updatedAt: now,
        })
        .where(eq(schema.candidates.id, row.id));
    }
  }
  summaries.push({
    rule: "Shortlisted, never interviewed (90 days)",
    affected: stale.length,
    detail: "Auto-moved to rejected with a 30-day deletion window",
  });

  /* 3. Closed / filled JDs older than 30 days → drop the stored document. */
  const jdCutoff = new Date(now.getTime() - 30 * 86_400_000);
  const closedJds = await db
    .select({ id: schema.jobDescriptions.id })
    .from(schema.jobDescriptions)
    .where(
      and(
        eq(schema.jobDescriptions.agencyId, agencyId),
        sql`${schema.jobDescriptions.status} in ('closed','filled')`,
        lte(schema.jobDescriptions.closedAt, jdCutoff),
        sql`${schema.jobDescriptions.jdFilePath} is not null`,
      ),
    );
  if (!dryRun) {
    for (const row of closedJds) {
      await db
        .update(schema.jobDescriptions)
        .set({ jdFilePath: null, jdText: null })
        .where(eq(schema.jobDescriptions.id, row.id));
    }
  }
  summaries.push({
    rule: "Closed / filled JD documents (30 days)",
    affected: closedJds.length,
    detail: "Document removed; position metadata retained",
  });

  /* 4. Duplicate CVs → keep the oldest copy. */
  const duplicates = await db
    .select({ id: schema.candidates.id })
    .from(schema.candidates)
    .where(
      and(eq(schema.candidates.agencyId, agencyId), sql`${schema.candidates.isDuplicateOf} is not null`),
    );
  if (!dryRun) {
    for (const row of duplicates) {
      await db
        .update(schema.candidates)
        .set({ cvText: null, cvVector: null, cvFilePath: null, currentStatus: "rejected", tags: ["duplicate"] })
        .where(eq(schema.candidates.id, row.id));
    }
  }
  summaries.push({
    rule: "Duplicate CVs",
    affected: duplicates.length,
    detail: "Oldest copy retained; duplicate document dropped and merge history kept",
  });

  /* 5. AI interview recordings older than 90 days → transcripts only. */
  const recCutoff = new Date(now.getTime() - 90 * 86_400_000);
  const recordings = await db
    .select({ id: schema.interviewsAi.id })
    .from(schema.interviewsAi)
    .where(
      and(
        eq(schema.interviewsAi.agencyId, agencyId),
        lte(schema.interviewsAi.invitedAt, recCutoff),
        sql`(${schema.interviewsAi.audioUrl} is not null or ${schema.interviewsAi.videoUrl} is not null)`,
      ),
    );
  if (!dryRun) {
    for (const row of recordings) {
      await db
        .update(schema.interviewsAi)
        .set({ audioUrl: null, videoUrl: null })
        .where(eq(schema.interviewsAi.id, row.id));
    }
  }
  summaries.push({
    rule: "AI interview recordings (90 days, GDPR)",
    affected: recordings.length,
    detail: "Audio/video deleted; transcript and AI scores retained",
  });

  /* 6. Audit logs older than 1 year → purge. */
  const auditCutoff = new Date(now.getTime() - 365 * 86_400_000);
  const oldAudit = await db
    .select({ id: schema.auditLogs.id })
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.agencyId, agencyId), lte(schema.auditLogs.createdAt, auditCutoff)));
  if (!dryRun) {
    for (const row of oldAudit) {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.id, row.id));
    }
  }
  summaries.push({
    rule: "Audit logs (1 year)",
    affected: oldAudit.length,
    detail: "Purged after the retention window",
  });

  if (!dryRun) {
    for (const summary of summaries) {
      await db.insert(schema.cleanupLogs).values({
        id: newId("cln"),
        rule: summary.rule,
        affectedCount: summary.affected,
        details: summary.detail,
      });
    }
  }

  return summaries;
}

/** Restore an encrypted snapshot back into the database. */
export async function restoreBackup(encrypted: Buffer, expectedChecksum?: string) {
  if (expectedChecksum && checksum(encrypted) !== expectedChecksum) {
    throw new Error("Integrity check failed — checksum mismatch");
  }
  const json = JSON.parse(gunzipSync(decrypt(encrypted)).toString("utf8")) as {
    tables: Record<string, Record<string, unknown>[]>;
  };

  let restored = 0;
  for (const [name, table] of Object.entries(ALL_TABLES)) {
    const rows = json.tables[name];
    if (!rows?.length) continue;
    for (const row of rows) {
      const parsed = Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v,
        ]),
      );
      await db
        .insert(table as never)
        .values(parsed as never)
        .onConflictDoNothing();
      restored++;
    }
  }
  return { restored };
}
