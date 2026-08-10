import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { DEFAULT_AGENCY_SETTINGS } from "../database/schema";
import { newId } from "../lib/ids";
import { adminOnly, audit, authed, getSettings } from "../middleware/auth";
import { isSupportedVoice } from "../lib/voices";

export const settings = {
  get: authed.handler(async ({ context }) => {
    const [agency] = await db
      .select()
      .from(schema.agencies)
      .where(eq(schema.agencies.id, context.agencyId))
      .limit(1);
    const reasons = await db
      .select()
      .from(schema.blacklistReasons)
      .where(
        and(
          eq(schema.blacklistReasons.agencyId, context.agencyId),
          eq(schema.blacklistReasons.isActive, true),
        ),
      );
    return {
      agency: agency
        ? { id: agency.id, name: agency.name, slug: agency.slug, logoUrl: agency.logoUrl, subscriptionTier: agency.subscriptionTier }
        : null,
      values: await getSettings(context.agencyId),
      defaults: DEFAULT_AGENCY_SETTINGS,
      blacklistReasons: reasons,
    };
  }),

  update: adminOnly
    .input(
      z.object({
        agencyName: z.string().optional(),
        shortlistThreshold: z.number().min(0).max(100).optional(),
        /** Score expiry window in days — 60 by default. */
        scoreExpiryDays: z.number().min(1).max(730).optional(),
        matchWeight: z.number().min(0).max(1).optional(),
        techWeight: z.number().min(0).max(1).optional(),
        aiInterviewEnabled: z.boolean().optional(),
        backupTime: z.string().optional(),
        backupAlertEmail: z.string().optional(),
        dailyRetentionDays: z.number().min(1).max(365).optional(),
        weeklyRetentionDays: z.number().min(1).max(730).optional(),
        /* ---- security ---- */
        sessionIdleMinutes: z.number().min(0).max(480).optional(),
        /* ---- AI interview ---- */
        aiInterviewMinMinutes: z.number().min(3).max(60).optional(),
        aiInterviewMaxMinutes: z.number().min(5).max(90).optional(),
        aiSilenceNudgeSeconds: z.number().min(3).max(60).optional(),
        aiSmallTalkEnabled: z.boolean().optional(),
        /** Realtime interviewer voice id — validated against the voice catalogue. */
        aiVoice: z.string().refine(isSupportedVoice, "Unsupported interviewer voice").optional(),
        aiProctoringEnabled: z.boolean().optional(),
        aiAwayPenaltyMultiplier: z.number().min(0).max(10).optional(),
        /* ---- buckets ---- */
        blueTagMinAiMatch: z.number().min(0).max(100).optional(),
        purpleTagMinTechScore: z.number().min(0).max(100).optional(),
        clientFailLimit: z.number().min(1).max(10).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const current = await getSettings(context.agencyId);
      const { agencyName, ...rest } = input;
      const next = { ...current, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };

      /* The interview window must stay ordered. */
      if (next.aiInterviewMaxMinutes < next.aiInterviewMinMinutes) {
        next.aiInterviewMaxMinutes = next.aiInterviewMinMinutes;
      }

      /* Keep the final-score weights summing to 1. */
      if (rest.matchWeight != null && rest.techWeight == null) next.techWeight = 1 - rest.matchWeight;
      if (rest.techWeight != null && rest.matchWeight == null) next.matchWeight = 1 - rest.techWeight;

      await db
        .update(schema.agencies)
        .set({ settings: next, ...(agencyName ? { name: agencyName } : {}) })
        .where(eq(schema.agencies.id, context.agencyId));

      await audit(context.user, "settings.updated", "agency", context.agencyId, next);
      return next;
    }),

  addBlacklistReason: adminOnly
    .input(z.object({ label: z.string().min(1) }))
    .handler(async ({ input, context }) => {
      const id = newId("blr");
      await db
        .insert(schema.blacklistReasons)
        .values({ id, agencyId: context.agencyId, label: input.label });
      return { id };
    }),

  removeBlacklistReason: adminOnly
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      await db
        .update(schema.blacklistReasons)
        .set({ isActive: false })
        .where(
          and(
            eq(schema.blacklistReasons.id, input.id),
            eq(schema.blacklistReasons.agencyId, context.agencyId),
          ),
        );
      return { ok: true };
    }),
};
