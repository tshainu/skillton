import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { base } from "../__core/app";
import { auth } from "../auth";
import { db } from "../database";
import * as schema from "../database/schema";
import { DEFAULT_AGENCY_SETTINGS, type AgencySettings } from "../database/schema";
import { newId } from "../lib/ids";
import { seedAgencyDefaults } from "../lib/seed";
import { touchSession } from "../lib/security";

export type Role =
  | "super_admin"
  | "agency_admin"
  | "recruiter"
  | "tech_interviewer"
  | "client"
  | "candidate";

export const ROLES: Role[] = [
  "super_admin",
  "agency_admin",
  "recruiter",
  "tech_interviewer",
  "client",
  "candidate",
];

export interface AppUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role: Role;
  agencyId: string;
}

/** Optional auth — `context.user` is the session user or null. */
export const withUser = base.use(async ({ context, next }) => {
  const session = await auth.api.getSession({ headers: context.headers });
  return next({ context: { user: session?.user ?? null } });
});

/**
 * Protected procedures. Every user belongs to an agency; the first user to sign
 * in provisions the workspace and becomes its super admin, later users join it
 * as recruiters. Agency defaults (screening questions, tech template, blacklist
 * reasons) are seeded once.
 */
export const authed = base.use(async ({ context, next }) => {
  const session = await auth.api.getSession({ headers: context.headers });
  if (!session) throw new ORPCError("UNAUTHORIZED", { message: "Sign in to continue" });

  const raw = session.user as typeof session.user & {
    role?: string | null;
    agencyId?: string | null;
    isActive?: boolean | null;
  };

  if (raw.isActive === false) {
    throw new ORPCError("FORBIDDEN", { message: "This account has been deactivated" });
  }

  let agencyId = raw.agencyId ?? null;
  let role = (raw.role as Role | null) ?? null;

  if (!agencyId) {
    const [existing] = await db.select().from(schema.agencies).limit(1);
    if (existing) {
      agencyId = existing.id;
      role = role ?? "recruiter";
    } else {
      const id = newId("agc");
      const derived = raw.email?.split("@")[1]?.split(".")[0] ?? "agency";
      await db.insert(schema.agencies).values({
        id,
        name: `${derived.charAt(0).toUpperCase()}${derived.slice(1)} Recruitment`,
        slug: `${derived}-${id.slice(4, 10)}`,
        settings: DEFAULT_AGENCY_SETTINGS,
      });
      await seedAgencyDefaults(id);
      agencyId = id;
      role = "super_admin";
    }
    await db
      .update(schema.user)
      .set({ agencyId, role })
      .where(eq(schema.user.id, session.user.id));
  }

  /* Auto-logout: idle sessions are rejected server-side, independently of the
     cookie lifetime, so an unattended browser cannot be picked up later. */
  const settings = await getSettings(agencyId!);
  const idle = touchSession(session.session.id, settings.sessionIdleMinutes);
  if (idle.expired) {
    await auth.api.revokeSession({
      headers: context.headers,
      body: { token: session.session.token },
    }).catch(() => undefined);
    throw new ORPCError("UNAUTHORIZED", {
      message: `Signed out after ${settings.sessionIdleMinutes} minutes of inactivity`,
    });
  }

  const user: AppUser = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
    role: (role ?? "recruiter") as Role,
    agencyId: agencyId!,
  };

  return next({ context: { user, agencyId: user.agencyId } });
});

/** Restrict a procedure to specific roles. */
export function requireRole(...allowed: Role[]) {
  return authed.use(async ({ context, next }) => {
    if (!allowed.includes(context.user.role)) {
      throw new ORPCError("FORBIDDEN", {
        message: `Requires role: ${allowed.join(" or ")}`,
      });
    }
    return next();
  });
}

export const adminOnly = requireRole("super_admin", "agency_admin");
export const superAdminOnly = requireRole("super_admin");

/** Load agency settings, merged over defaults. */
export async function getSettings(agencyId: string): Promise<AgencySettings> {
  const [agency] = await db
    .select()
    .from(schema.agencies)
    .where(eq(schema.agencies.id, agencyId))
    .limit(1);
  return { ...DEFAULT_AGENCY_SETTINGS, ...(agency?.settings ?? {}) };
}

/** Fire-and-forget audit trail entry. */
export async function audit(
  user: AppUser,
  action: string,
  entityType?: string,
  entityId?: string,
  newValues?: unknown,
) {
  await db.insert(schema.auditLogs).values({
    id: newId("aud"),
    agencyId: user.agencyId,
    userId: user.id,
    userName: user.name,
    action,
    entityType,
    entityId,
    newValues: newValues ?? null,
  });
}

/** Candidate timeline entry. */
export async function timeline(
  agencyId: string,
  candidateId: string,
  kind: string,
  title: string,
  detail?: string,
  actorName?: string,
) {
  await db.insert(schema.candidateEvents).values({
    id: newId("evt"),
    agencyId,
    candidateId,
    kind,
    title,
    detail,
    actorName,
  });
}

export async function notify(
  agencyId: string,
  title: string,
  body: string,
  kind = "info",
  link?: string,
) {
  await db.insert(schema.notifications).values({
    id: newId("ntf"),
    agencyId,
    title,
    body,
    kind,
    link,
  });
}
