import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../database";
import * as schema from "../database/schema";
import { s3, BUCKET } from "../lib/s3";
import { audit, getSettings, superAdminOnly, authed } from "../middleware/auth";
import { pruneBackups, restoreBackup, runBackup, runCleanup } from "../lib/backup";
import { driveConfigured, testDrive } from "../lib/backup-drive";
import { nextRun, rescheduleAgency, scheduleState } from "../lib/backup-scheduler";

/** Never send stored secrets back to the browser — only whether they are set. */
function maskSecret(value: string) {
  return value ? `••••••••${value.slice(-4)}` : "";
}

export const backup = {
  /** Status card + history + cleanup log for the Backup & Recovery page. */
  status: authed.handler(async ({ context }) => {
    const settings = await getSettings(context.agencyId);
    const history = await db
      .select()
      .from(schema.backupLogs)
      .orderBy(desc(schema.backupLogs.createdAt))
      .limit(40);
    const cleanup = await db
      .select()
      .from(schema.cleanupLogs)
      .orderBy(desc(schema.cleanupLogs.runAt))
      .limit(30);

    const successes = history.filter((h) => h.status === "success");
    const recent = history.slice(0, 2);
    const consecutiveFailures = recent.every((h) => h.status === "failed") ? recent.length : 0;

    const [next] = (() => {
      const [hour, minute] = settings.backupTime.split(":").map(Number);
      const target = new Date();
      target.setHours(hour ?? 2, minute ?? 0, 0, 0);
      if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
      return [target];
    })();

    const schedule = await scheduleState(context.agencyId);

    return {
      settings: {
        ...settings,
        gdriveClientSecret: maskSecret(settings.gdriveClientSecret),
        gdriveRefreshToken: maskSecret(settings.gdriveRefreshToken),
      },
      schedule: {
        autoBackupEnabled: settings.autoBackupEnabled,
        frequency: settings.backupFrequency,
        time: settings.backupTime,
        provider: settings.backupProvider,
        retainCopies: settings.backupRetainCopies,
        driveConnected: driveConfigured(settings),
        lastRunAt: schedule?.lastRunAt ?? null,
        lastStatus: schedule?.lastStatus ?? null,
        lastError: schedule?.lastError ?? null,
        nextRunAt:
          schedule?.nextRunAt ??
          (settings.autoBackupEnabled
            ? nextRun(new Date(), settings.backupTime, settings.backupFrequency)
            : null),
      },
      healthy: consecutiveFailures < 2,
      consecutiveFailures,
      lastBackup: successes[0] ?? null,
      nextBackupAt: next,
      storageUsedBytes: successes.reduce((s, h) => s + h.fileSizeBytes, 0),
      totalBackups: successes.length,
      history,
      cleanup,
      canManage: context.user.role === "super_admin" || context.user.role === "agency_admin",
    };
  }),

  /** Manual backup — encrypted AES-256-GCM snapshot pushed to object storage. */
  run: superAdminOnly
    .input(z.object({ tier: z.enum(["daily", "weekly", "monthly", "manual"]).default("manual") }))
    .handler(async ({ input, context }) => {
      const settings = await getSettings(context.agencyId);
      const result = await runBackup(context.agencyId, input.tier, context.user.name);
      const pruned = await pruneBackups(settings.dailyRetentionDays, settings.weeklyRetentionDays);
      await audit(context.user, "backup.run", "backup", result.id, { tier: input.tier, pruned });
      return { ...result, pruned };
    }),

  /** Presigned download of an encrypted artifact (still requires the key to read). */
  downloadUrl: superAdminOnly.input(z.object({ id: z.string() })).handler(async ({ input }) => {
    const [row] = await db
      .select()
      .from(schema.backupLogs)
      .where(eq(schema.backupLogs.id, input.id))
      .limit(1);
    if (!row?.storageKey) throw new ORPCError("NOT_FOUND", { message: "Backup artifact not found" });
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: row.storageKey }), {
      expiresIn: 900,
    });
    return { url, fileName: row.fileName };
  }),

  restore: superAdminOnly.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    const [row] = await db
      .select()
      .from(schema.backupLogs)
      .where(eq(schema.backupLogs.id, input.id))
      .limit(1);
    if (!row?.storageKey) throw new ORPCError("NOT_FOUND", { message: "Backup artifact not found" });

    const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: row.storageKey }));
    const bytes = await object.Body!.transformToByteArray();
    const result = await restoreBackup(Buffer.from(bytes), row.checksum ?? undefined);

    await audit(context.user, "backup.restored", "backup", row.id, result);
    return { ...result, fileName: row.fileName };
  }),

  /** Retention preview — no writes. */
  previewCleanup: authed.handler(({ context }) => runCleanup(context.agencyId, true)),

  runCleanup: superAdminOnly.handler(async ({ context }) => {
    const summaries = await runCleanup(context.agencyId, false);
    await audit(context.user, "cleanup.run", "agency", context.agencyId, {
      affected: summaries.reduce((s, x) => s + x.affected, 0),
    });
    return summaries;
  }),

  storageBreakdown: authed.handler(async ({ context }) => {
    const [candidates] = await db
      .select({
        total: sql<number>`count(*)`,
        withCv: sql<number>`sum(case when ${schema.candidates.cvFilePath} is not null then 1 else 0 end)`,
        anonymized: sql<number>`sum(case when ${schema.candidates.anonymizedAt} is not null then 1 else 0 end)`,
        permanent: sql<number>`sum(case when ${schema.candidates.retentionPolicy} = 'hired_permanent' then 1 else 0 end)`,
        scheduled: sql<number>`sum(case when ${schema.candidates.deletionScheduledAt} is not null then 1 else 0 end)`,
      })
      .from(schema.candidates)
      .where(eq(schema.candidates.agencyId, context.agencyId));

    return {
      candidates: Number(candidates?.total ?? 0),
      withCvFile: Number(candidates?.withCv ?? 0),
      anonymized: Number(candidates?.anonymized ?? 0),
      permanentRetention: Number(candidates?.permanent ?? 0),
      deletionScheduled: Number(candidates?.scheduled ?? 0),
    };
  }),

  /** Automatic backup settings — schedule, destination and Drive credentials. */
  saveSchedule: superAdminOnly
    .input(
      z.object({
        autoBackupEnabled: z.boolean(),
        backupFrequency: z.enum(["daily", "weekly", "monthly"]),
        /** 24h HH:MM. */
        backupTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM in 24-hour format"),
        backupProvider: z.enum(["tigris", "gdrive"]),
        backupRetainCopies: z.number().min(1).max(365),
        backupAlertEmail: z.string().email().or(z.literal("")).default(""),
        dailyRetentionDays: z.number().min(1).max(365),
        weeklyRetentionDays: z.number().min(1).max(730),
        gdriveFolderId: z.string().max(200).default(""),
        /** Omit to keep the stored value; send "" to clear it. */
        gdriveClientId: z.string().max(300).optional(),
        gdriveClientSecret: z.string().max(300).optional(),
        gdriveRefreshToken: z.string().max(600).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const current = await getSettings(context.agencyId);
      const next = { ...current, ...input };

      /* A masked value means "unchanged" — never overwrite a real secret with dots. */
      for (const key of ["gdriveClientId", "gdriveClientSecret", "gdriveRefreshToken"] as const) {
        const value = input[key];
        if (value === undefined || value.startsWith("••••")) next[key] = current[key];
      }

      await db
        .update(schema.agencies)
        .set({ settings: next })
        .where(eq(schema.agencies.id, context.agencyId));

      const scheduledFor = await rescheduleAgency(context.agencyId);
      await audit(context.user, "backup.schedule_saved", "agency", context.agencyId, {
        autoBackupEnabled: input.autoBackupEnabled,
        backupFrequency: input.backupFrequency,
        backupProvider: input.backupProvider,
      });
      return { ok: true, nextRunAt: scheduledFor };
    }),

  /** Verify the saved Google Drive credentials without uploading anything. */
  testDrive: superAdminOnly.handler(async ({ context }) => {
    const settings = await getSettings(context.agencyId);
    return testDrive(settings);
  }),
};
