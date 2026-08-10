/**
 * Releases interview invitations that the recruiter asked to be sent later.
 *
 * The invite row is created immediately (so the link exists and can be copied by
 * hand), but when `inviteSendAt` is in the future the email is parked. A single
 * in-process ticker wakes every minute, picks up everything now due and mails it.
 * A row is only ever attempted once: `inviteSentAt` is stamped on success and the
 * schedule is cleared on a permanent failure, so a broken address can never turn
 * into a mail loop.
 */

import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { interviewInviteEmail, sendEmail } from "./email";
import { getSettings } from "../middleware/auth";

const TICK_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

function siteUrl(): string {
  return (process.env.WEBSITE_URL ?? "").replace(/\/+$/, "");
}

/** Sends every invitation whose send time has passed. Returns how many went out. */
export async function releaseDueInvites(now = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(schema.interviewsAi)
    .where(
      and(
        isNull(schema.interviewsAi.inviteSentAt),
        lte(schema.interviewsAi.inviteSendAt, now),
        sql`${schema.interviewsAi.inviteSendAt} is not null`,
        eq(schema.interviewsAi.status, "pending"),
      ),
    )
    .limit(50);

  let sent = 0;
  for (const row of due) {
    /* Never mail a link that has already expired — the candidate would only hit
       an error page. The schedule is cleared so it is not retried forever. */
    if (row.expiresAt && row.expiresAt.getTime() < now.getTime()) {
      await db
        .update(schema.interviewsAi)
        .set({ inviteSendAt: null })
        .where(eq(schema.interviewsAi.id, row.id));
      continue;
    }

    const [candidate] = await db
      .select({
        firstName: schema.candidates.firstName,
        lastName: schema.candidates.lastName,
        email: schema.candidates.email,
      })
      .from(schema.candidates)
      .where(eq(schema.candidates.id, row.candidateId))
      .limit(1);
    const to = row.inviteEmail ?? candidate?.email ?? null;
    if (!to) {
      await db
        .update(schema.interviewsAi)
        .set({ inviteSendAt: null })
        .where(eq(schema.interviewsAi.id, row.id));
      continue;
    }

    const [agency] = await db
      .select({ name: schema.agencies.name })
      .from(schema.agencies)
      .where(eq(schema.agencies.id, row.agencyId))
      .limit(1);
    const jobTitle = row.jdId
      ? ((
          await db
            .select({ title: schema.jobDescriptions.title })
            .from(schema.jobDescriptions)
            .where(eq(schema.jobDescriptions.id, row.jdId))
            .limit(1)
        )[0]?.title ?? null)
      : null;
    const settings = await getSettings(row.agencyId);

    const mail = interviewInviteEmail({
      candidateName: `${candidate?.firstName ?? ""} ${candidate?.lastName ?? ""}`.trim() || "there",
      jobTitle,
      link: `${siteUrl()}/interview/${row.token}`,
      minMinutes: settings.aiInterviewMinMinutes,
      maxMinutes: settings.aiInterviewMaxMinutes,
      expiresAt: row.expiresAt ?? new Date(now.getTime() + 7 * 86_400_000),
      agencyName: agency?.name ?? null,
      rescheduled: row.inviteIsReschedule,
      scheduledAt: row.scheduledAt,
    });
    const result = await sendEmail({ to, ...mail });

    if (result.sent) {
      sent++;
      await db
        .update(schema.interviewsAi)
        .set({ inviteSentAt: new Date(), inviteSendAt: null })
        .where(eq(schema.interviewsAi.id, row.id));
      await db.insert(schema.notifications).values({
        id: `ntf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        agencyId: row.agencyId,
        title: "Scheduled interview invitation sent",
        body: `The interview invitation for ${candidate?.firstName ?? "the candidate"} ${
          candidate?.lastName ?? ""
        } was emailed to ${to} as scheduled.`.trim(),
        kind: "success",
        link: "/ai-interviews",
      });
    } else {
      /* Mail is not configured or the address was rejected. Tell the recruiter
         once and stop trying — they still have the link on the page. */
      await db
        .update(schema.interviewsAi)
        .set({ inviteSendAt: null })
        .where(eq(schema.interviewsAi.id, row.id));
      await db.insert(schema.notifications).values({
        id: `ntf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        agencyId: row.agencyId,
        title: "Scheduled interview invitation could not be sent",
        body: `${to}: ${result.reason ?? "unknown error"}. Copy the interview link and send it manually.`,
        kind: "error",
        link: "/ai-interviews",
      });
    }
  }
  return sent;
}

/** Start the ticker once per process. Safe to call repeatedly. */
export function startInviteScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    void releaseDueInvites().catch(() => {
      /* A scheduler error must never take the server down. */
    });
  }, TICK_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
}
