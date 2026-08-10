import { and, eq, sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";

const PREFIX = "CID-";
const WIDTH = 5;

export function formatCid(sequence: number): string {
  return `${PREFIX}${String(sequence).padStart(WIDTH, "0")}`;
}

/**
 * Allocates the next human-facing candidate id for an agency (CID-00001, CID-00002, ...).
 * Retries on collision because SQLite has no sequence primitive here.
 */
export async function allocateCid(agencyId: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const [row] = await db
      .select({
        max: sql<number>`coalesce(max(cast(substr(${schema.candidates.cid}, ${PREFIX.length + 1}) as integer)), 0)`,
      })
      .from(schema.candidates)
      .where(
        and(
          eq(schema.candidates.agencyId, agencyId),
          sql`${schema.candidates.cid} like ${`${PREFIX}%`}`,
        ),
      );
    const next = Number(row?.max ?? 0) + 1 + attempt;
    const candidateCid = formatCid(next);
    const [taken] = await db
      .select({ id: schema.candidates.id })
      .from(schema.candidates)
      .where(
        and(eq(schema.candidates.agencyId, agencyId), eq(schema.candidates.cid, candidateCid)),
      )
      .limit(1);
    if (!taken) return candidateCid;
  }
  return `${PREFIX}${Date.now().toString().slice(-6)}`;
}

/**
 * Allocates a contiguous block of CIDs for a bulk insert. Doing this in one go
 * avoids handing the same number to every row of the batch.
 */
export async function allocateCidBlock(agencyId: string, count: number): Promise<string[]> {
  if (count <= 0) return [];
  const first = await allocateCid(agencyId);
  const start = Number(first.slice(PREFIX.length));
  if (Number.isNaN(start)) return Array.from({ length: count }, () => formatCid(Date.now() % 100000));
  return Array.from({ length: count }, (_, i) => formatCid(start + i));
}

/** Fills in missing CIDs for an agency, oldest candidate first. Returns how many were assigned. */
export async function backfillCids(agencyId: string): Promise<number> {
  const missing = await db
    .select({ id: schema.candidates.id, createdAt: schema.candidates.createdAt })
    .from(schema.candidates)
    .where(and(eq(schema.candidates.agencyId, agencyId), sql`${schema.candidates.cid} is null`));
  missing.sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0));
  let assigned = 0;
  for (const row of missing) {
    const cid = await allocateCid(agencyId);
    await db.update(schema.candidates).set({ cid }).where(eq(schema.candidates.id, row.id));
    assigned += 1;
  }
  return assigned;
}
