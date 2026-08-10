import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { newId } from "../lib/ids";
import { adminOnly, audit, authed } from "../middleware/auth";

const clientInput = z.object({
  companyName: z.string().min(1),
  industry: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
  cultureNotes: z.string().optional(),
  preferences: z.record(z.string(), z.string()).optional(),
  /* ------------------------------------ sourcing, culture and commercials */
  website: z.string().max(300).optional(),
  companySize: z.string().max(60).optional(),
  headquarters: z.string().max(160).optional(),
  locations: z.array(z.string().max(120)).max(30).optional(),
  accountManager: z.string().max(120).optional(),
  contactRole: z.string().max(120).optional(),
  sourceChannel: z.enum(["direct", "referral", "inbound", "linkedin", "event", "partner"]).optional(),
  relationshipStatus: z.enum(["active", "prospect", "dormant", "churned"]).optional(),
  contractType: z.string().max(80).optional(),
  feeStructure: z.string().max(160).optional(),
  paymentTerms: z.string().max(120).optional(),
  slaDays: z.number().min(0).max(365).optional(),
  workModel: z.enum(["onsite", "hybrid", "remote"]).optional(),
  techStack: z.array(z.string().max(60)).max(40).optional(),
  benefits: z.array(z.string().max(80)).max(30).optional(),
  interviewProcess: z.string().max(2000).optional(),
  dealBreakers: z.string().max(2000).optional(),
  idealCandidateProfile: z.string().max(2000).optional(),
  notes: z.string().max(4000).optional(),
});

export const clients = {
  list: authed.handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.agencyId, context.agencyId))
      .orderBy(desc(schema.clients.createdAt));

    const jobCounts = await db
      .select({
        clientId: schema.jobDescriptions.clientId,
        open: sql<number>`sum(case when ${schema.jobDescriptions.status} = 'open' then 1 else 0 end)`,
        total: sql<number>`count(*)`,
      })
      .from(schema.jobDescriptions)
      .where(eq(schema.jobDescriptions.agencyId, context.agencyId))
      .groupBy(schema.jobDescriptions.clientId);

    const placed = await db
      .select({
        clientId: schema.placements.clientId,
        total: sql<number>`count(*)`,
      })
      .from(schema.placements)
      .where(eq(schema.placements.agencyId, context.agencyId))
      .groupBy(schema.placements.clientId);

    return rows.map((client) => ({
      ...client,
      openJobs: Number(jobCounts.find((j) => j.clientId === client.id)?.open ?? 0),
      totalJobs: Number(jobCounts.find((j) => j.clientId === client.id)?.total ?? 0),
      placements: Number(placed.find((p) => p.clientId === client.id)?.total ?? 0),
    }));
  }),

  get: authed.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.id, input.id), eq(schema.clients.agencyId, context.agencyId)))
      .limit(1);
    if (!client) throw new ORPCError("NOT_FOUND", { message: "Client not found" });
    const jobs = await db
      .select()
      .from(schema.jobDescriptions)
      .where(eq(schema.jobDescriptions.clientId, input.id))
      .orderBy(desc(schema.jobDescriptions.createdAt));
    return { client, jobs };
  }),

  create: authed.input(clientInput).handler(async ({ input, context }) => {
    const [row] = await db
      .insert(schema.clients)
      .values({ id: newId("cli"), agencyId: context.agencyId, ...input })
      .returning();
    await audit(context.user, "client.created", "client", row!.id, { name: input.companyName });
    return row!;
  }),

  update: authed
    .input(clientInput.partial().extend({ id: z.string() }))
    .handler(async ({ input, context }) => {
      const { id, ...rest } = input;
      const [row] = await db
        .update(schema.clients)
        .set(rest)
        .where(and(eq(schema.clients.id, id), eq(schema.clients.agencyId, context.agencyId)))
        .returning();
      if (!row) throw new ORPCError("NOT_FOUND");
      await audit(context.user, "client.updated", "client", id, rest);
      return row;
    }),

  remove: adminOnly.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    await db
      .delete(schema.clients)
      .where(and(eq(schema.clients.id, input.id), eq(schema.clients.agencyId, context.agencyId)));
    await audit(context.user, "client.deleted", "client", input.id);
    return { ok: true };
  }),
};
