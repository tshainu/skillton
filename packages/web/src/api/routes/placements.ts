import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { audit, authed } from "../middleware/auth";

/** Placed / hired register — who got the job, where, and how they scored. */
export const placements = {
  list: authed
    .input(
      z
        .object({
          search: z.string().optional(),
          clientId: z.string().optional(),
          year: z.number().optional(),
          status: z.enum(["active", "probation", "completed", "left"]).optional(),
        })
        .optional(),
    )
    .handler(async ({ input, context }) => {
      const where = [eq(schema.placements.agencyId, context.agencyId)];
      if (input?.clientId) where.push(eq(schema.placements.clientId, input.clientId));
      if (input?.status) where.push(eq(schema.placements.status, input.status));
      if (input?.search) {
        const q = `%${input.search.toLowerCase()}%`;
        where.push(
          sql`(lower(${schema.placements.candidateName}) like ${q} or lower(${schema.placements.positionTitle}) like ${q} or lower(coalesce(${schema.placements.clientName}, '')) like ${q})`,
        );
      }

      const rows = await db
        .select()
        .from(schema.placements)
        .where(and(...where))
        .orderBy(desc(schema.placements.placedAt));

      return input?.year
        ? rows.filter((r) => r.placedAt.getFullYear() === input.year)
        : rows;
    }),

  stats: authed.handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(schema.placements)
      .where(eq(schema.placements.agencyId, context.agencyId));

    const now = new Date();
    const thisMonth = rows.filter(
      (r) => r.placedAt.getMonth() === now.getMonth() && r.placedAt.getFullYear() === now.getFullYear(),
    );
    const withTime = rows.filter((r) => r.timeToHireDays != null);
    const withFinal = rows.filter((r) => r.finalScore != null);

    const byClient = new Map<string, number>();
    for (const row of rows) {
      const key = row.clientName ?? "Direct";
      byClient.set(key, (byClient.get(key) ?? 0) + 1);
    }

    const byMonth: { month: string; placements: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString("en-US", { month: "short" });
      byMonth.push({
        month: label,
        placements: rows.filter(
          (r) => r.placedAt.getMonth() === d.getMonth() && r.placedAt.getFullYear() === d.getFullYear(),
        ).length,
      });
    }

    return {
      total: rows.length,
      thisMonth: thisMonth.length,
      avgTimeToHire: withTime.length
        ? Math.round(withTime.reduce((s, r) => s + (r.timeToHireDays ?? 0), 0) / withTime.length)
        : null,
      avgFinalScore: withFinal.length
        ? Math.round((withFinal.reduce((s, r) => s + (r.finalScore ?? 0), 0) / withFinal.length) * 10) / 10
        : null,
      activeCount: rows.filter((r) => r.status === "active").length,
      byClient: [...byClient.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      byMonth,
    };
  }),

  get: authed.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    const [row] = await db
      .select()
      .from(schema.placements)
      .where(and(eq(schema.placements.id, input.id), eq(schema.placements.agencyId, context.agencyId)))
      .limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Placement not found" });
    return row;
  }),

  update: authed
    .input(
      z.object({
        id: z.string(),
        status: z.enum(["active", "probation", "completed", "left"]).optional(),
        offeredSalary: z.string().optional(),
        startDate: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const { id, startDate, ...rest } = input;
      const [row] = await db
        .update(schema.placements)
        .set({ ...rest, ...(startDate ? { startDate: new Date(startDate) } : {}) })
        .where(and(eq(schema.placements.id, id), eq(schema.placements.agencyId, context.agencyId)))
        .returning();
      if (!row) throw new ORPCError("NOT_FOUND");
      await audit(context.user, "placement.updated", "placement", id, rest);
      return row;
    }),
};
