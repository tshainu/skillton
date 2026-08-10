import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import type { AgencySettings } from "../database/schema";
import { adminOnly, audit, authed, getSettings, ROLES, withUser } from "../middleware/auth";

/** Strip server-only secrets before settings reach the browser. */
function publicSettings(settings: AgencySettings) {
  const { gdriveClientSecret: _s, gdriveRefreshToken: _r, ...rest } = settings;
  return rest;
}

export const session = {
  /** Current user + agency + effective settings. Null when signed out. */
  me: withUser.handler(async ({ context }) => {
    if (!context.user) return null;
    const raw = context.user as typeof context.user & { role?: string; agencyId?: string };
    if (!raw.agencyId) return { needsProvisioning: true as const };
    const [agency] = await db
      .select()
      .from(schema.agencies)
      .where(eq(schema.agencies.id, raw.agencyId))
      .limit(1);
    return {
      needsProvisioning: false as const,
      user: {
        id: context.user.id,
        name: context.user.name,
        email: context.user.email,
        image: context.user.image,
        role: (raw.role ?? "recruiter") as string,
        agencyId: raw.agencyId,
      },
      agency: agency ? { id: agency.id, name: agency.name, logoUrl: agency.logoUrl } : null,
      settings: publicSettings(await getSettings(raw.agencyId)),
    };
  }),

  /**
   * Keeps the session alive while the user is actually working, and tells the
   * client how long it may stay idle before it is signed out.
   */
  heartbeat: authed.handler(async ({ context }) => {
    const settings = await getSettings(context.agencyId);
    return { ok: true, sessionIdleMinutes: settings.sessionIdleMinutes, serverTime: Date.now() };
  }),

  /** Forces provisioning of the agency for a brand new user. */
  bootstrap: authed.handler(async ({ context }) => {
    const [agency] = await db
      .select()
      .from(schema.agencies)
      .where(eq(schema.agencies.id, context.agencyId))
      .limit(1);
    return { user: context.user, agency, settings: publicSettings(await getSettings(context.agencyId)) };
  }),

  teamMembers: authed.handler(({ context }) =>
    db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        image: schema.user.image,
        role: schema.user.role,
        isActive: schema.user.isActive,
        createdAt: schema.user.createdAt,
      })
      .from(schema.user)
      .where(eq(schema.user.agencyId, context.agencyId))
      .orderBy(desc(schema.user.createdAt)),
  ),

  setRole: adminOnly
    .input(z.object({ userId: z.string(), role: z.enum(ROLES as [string, ...string[]]) }))
    .handler(async ({ input, context }) => {
      await db
        .update(schema.user)
        .set({ role: input.role })
        .where(and(eq(schema.user.id, input.userId), eq(schema.user.agencyId, context.agencyId)));
      await audit(context.user, "user.role_changed", "user", input.userId, { role: input.role });
      return { ok: true };
    }),

  setActive: adminOnly
    .input(z.object({ userId: z.string(), isActive: z.boolean() }))
    .handler(async ({ input, context }) => {
      await db
        .update(schema.user)
        .set({ isActive: input.isActive })
        .where(and(eq(schema.user.id, input.userId), eq(schema.user.agencyId, context.agencyId)));
      await audit(context.user, "user.active_changed", "user", input.userId, input);
      return { ok: true };
    }),

  notifications: authed.handler(({ context }) =>
    db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.agencyId, context.agencyId))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(30),
  ),

  markNotificationsRead: authed.handler(async ({ context }) => {
    await db
      .update(schema.notifications)
      .set({ isRead: true })
      .where(eq(schema.notifications.agencyId, context.agencyId));
    return { ok: true };
  }),

  auditLog: adminOnly
    .input(z.object({ limit: z.number().min(1).max(200).default(60) }).optional())
    .handler(({ input, context }) =>
      db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.agencyId, context.agencyId))
        .orderBy(desc(schema.auditLogs.createdAt))
        .limit(input?.limit ?? 60),
    ),
};
