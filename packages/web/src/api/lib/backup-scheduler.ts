import { eq } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { DEFAULT_AGENCY_SETTINGS, type AgencySettings } from "../database/schema";
import { pruneBackups, runBackup, type BackupTier } from "./backup";

/**
 * Automatic backups.
 *
 * A single in-process ticker wakes every minute, and for each agency with
 * automatic backups switched on it runs a snapshot once the scheduled wall-clock
 * time has passed. `backup_schedules` records the last and next run so a restart
 * never double-runs or silently skips a day.
 */

const TICK_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

/** Next occurrence of HH:MM after `from`, respecting the chosen frequency. */
export function nextRun(from: Date, time: string, frequency: string): Date {
  const [hour = 2, minute = 0] = time.split(":").map((v) => Number(v) || 0);
  const next = new Date(from);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
  if (frequency === "weekly") {
    /* Run on Sundays. */
    while (next.getDay() !== 0) next.setDate(next.getDate() + 1);
  } else if (frequency === "monthly") {
    if (next.getDate() !== 1) {
      next.setMonth(next.getMonth() + 1, 1);
      next.setHours(hour, minute, 0, 0);
    }
  }
  return next;
}

function tierFor(frequency: string): BackupTier {
  if (frequency === "weekly") return "weekly";
  if (frequency === "monthly") return "monthly";
  return "daily";
}

async function settingsFor(agencyId: string): Promise<AgencySettings> {
  const [agency] = await db
    .select()
    .from(schema.agencies)
    .where(eq(schema.agencies.id, agencyId))
    .limit(1);
  return { ...DEFAULT_AGENCY_SETTINGS, ...(agency?.settings ?? {}) };
}

/** Recompute and store the next run — called whenever backup settings change. */
export async function rescheduleAgency(agencyId: string) {
  const settings = await settingsFor(agencyId);
  const next = settings.autoBackupEnabled
    ? nextRun(new Date(), settings.backupTime, settings.backupFrequency)
    : null;
  await db
    .insert(schema.backupSchedules)
    .values({ agencyId, nextRunAt: next })
    .onConflictDoUpdate({ target: schema.backupSchedules.agencyId, set: { nextRunAt: next } });
  return next;
}

export async function scheduleState(agencyId: string) {
  const [row] = await db
    .select()
    .from(schema.backupSchedules)
    .where(eq(schema.backupSchedules.agencyId, agencyId))
    .limit(1);
  return row ?? null;
}

/** Run one agency's scheduled backup now, and set the following run time. */
async function runScheduled(agencyId: string, settings: AgencySettings) {
  const tier = tierFor(settings.backupFrequency);
  try {
    await runBackup(agencyId, tier, "Automatic schedule");
    await pruneBackups(settings.dailyRetentionDays, settings.weeklyRetentionDays);
    await db
      .update(schema.backupSchedules)
      .set({
        lastRunAt: new Date(),
        lastStatus: "success",
        lastError: null,
        nextRunAt: nextRun(new Date(), settings.backupTime, settings.backupFrequency),
      })
      .where(eq(schema.backupSchedules.agencyId, agencyId));
  } catch (error) {
    await db
      .update(schema.backupSchedules)
      .set({
        lastRunAt: new Date(),
        lastStatus: "failed",
        lastError: (error as Error).message.slice(0, 400),
        nextRunAt: nextRun(new Date(), settings.backupTime, settings.backupFrequency),
      })
      .where(eq(schema.backupSchedules.agencyId, agencyId));
    await db.insert(schema.notifications).values({
      id: `ntf_${Date.now().toString(36)}`,
      agencyId,
      title: "Automatic backup failed",
      body: (error as Error).message.slice(0, 300),
      kind: "error",
      link: "/backup",
    });
  }
}

async function tick() {
  const agencies = await db.select({ id: schema.agencies.id }).from(schema.agencies);
  const now = Date.now();
  for (const agency of agencies) {
    const settings = await settingsFor(agency.id);
    if (!settings.autoBackupEnabled) continue;

    const state = await scheduleState(agency.id);
    if (!state?.nextRunAt) {
      await rescheduleAgency(agency.id);
      continue;
    }
    if (state.nextRunAt.getTime() > now) continue;
    await runScheduled(agency.id, settings);
  }
}

/** Start the ticker once per process. Safe to call repeatedly. */
export function startBackupScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    void tick().catch(() => {
      /* Never let a scheduler error take the server down. */
    });
  }, TICK_MS);
  /* Do not hold the process open in short-lived environments. */
  (timer as unknown as { unref?: () => void }).unref?.();
}
