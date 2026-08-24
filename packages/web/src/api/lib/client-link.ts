/**
 * Linking a job description to a client record.
 *
 * The `clients` table started empty while every JD carried its client's name
 * inside the title — "Systems Administrator (The Living Co)" — so the Client
 * column on every screen was blank and nothing could be grouped by client. This
 * derives the client from the JD instead of asking a recruiter to retype it.
 *
 * Two sources, cheapest first:
 *
 *   1. The title parenthetical. Free, deterministic, and the convention this
 *      agency already types by hand.
 *   2. `parsed.companyName` from the JD document, which the AI extraction fills
 *      only when the document actually names the hiring company.
 *
 * Matching an existing client is deliberately fuzzy on punctuation and company
 * suffixes, so "The Living Co", "The Living Co." and "The Living Company" resolve
 * to one record rather than three.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { newId } from "./ids";

/** Words that carry no identity — dropped before comparing two company names. */
const SUFFIXES = new Set([
  "ltd",
  "limited",
  "pvt",
  "private",
  "plc",
  "inc",
  "incorporated",
  "llc",
  "llp",
  "co",
  "company",
  "corp",
  "corporation",
  "group",
  "holdings",
  "pty",
  "gmbh",
  "bv",
  "sa",
  "ag",
]);

/** Comparison key for a company name: case, punctuation and suffixes ignored. */
export function clientKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SUFFIXES.has(w))
    .join(" ");
}

/**
 * Client name written into a JD title, by the convention already in use:
 * "Systems Administrator (The Living Co)". Rejects parentheticals that are
 * plainly not a company — locations, seniority, contract terms — because
 * "Engineer (Remote)" must not create a client called Remote.
 */
const NOT_A_COMPANY =
  /^(remote|hybrid|onsite|on-?site|contract|permanent|part-?time|full-?time|urgent|new|internal|\d+\s*(positions?|openings?|vacancies)|level\s*\d.*|senior|junior|mid|lead|night shift|day shift|wfh|colombo|kandy|galle|sri lanka|australia|uk|usa)$/i;

export function clientNameFromTitle(title: string): string | null {
  const matches = [...title.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]!.trim());
  for (const candidate of matches.reverse()) {
    if (!candidate || candidate.length < 2 || candidate.length > 80) continue;
    if (NOT_A_COMPANY.test(candidate)) continue;
    if (/^\d+$/.test(candidate)) continue;
    return candidate;
  }
  return null;
}

/** The title with the client parenthetical removed, for a clean display title. */
export function titleWithoutClient(title: string, clientName: string): string {
  return title
    .replace(new RegExp(`\\s*\\(\\s*${clientName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\)`, "i"), "")
    .trim();
}

/**
 * Find a client by name, or create one. Returns null for an unusable name so a
 * caller can fall back to leaving the JD unlinked rather than inventing a record.
 */
export async function ensureClientByName(agencyId: string, rawName: string) {
  const name = rawName.trim().replace(/\s+/g, " ");
  const key = clientKey(name);
  if (!name || !key) return null;

  const existing = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.agencyId, agencyId));
  const hit = existing.find((c) => clientKey(c.companyName) === key);
  if (hit) return hit;

  const [created] = await db
    .insert(schema.clients)
    .values({
      id: newId("cli"),
      agencyId,
      companyName: name,
      /* A client derived from a JD is a real account, but nobody has confirmed
         the commercials yet — `prospect` keeps it out of active reporting until
         a human fills the rest in. */
      relationshipStatus: "prospect",
      sourceChannel: "inbound",
      notes: "Created automatically from a job description. Details need confirming.",
    })
    .returning();
  return created ?? null;
}

export interface ClientLinkResult {
  clientId: string | null;
  clientName: string | null;
  /** Where the name came from — surfaced so a recruiter can judge it. */
  source: "existing-link" | "title" | "document" | "none";
  created: boolean;
}

/**
 * Resolve and attach a client to one JD. Never overwrites a link a human already
 * made: an existing `clientId` always wins.
 */
export async function linkJobToClient(
  agencyId: string,
  job: typeof schema.jobDescriptions.$inferSelect,
): Promise<ClientLinkResult> {
  if (job.clientId) {
    const [current] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.id, job.clientId), eq(schema.clients.agencyId, agencyId)))
      .limit(1);
    if (current) {
      return {
        clientId: current.id,
        clientName: current.companyName,
        source: "existing-link",
        created: false,
      };
    }
  }

  const fromTitle = clientNameFromTitle(job.title);
  const fromDoc = job.parsed?.companyName?.trim() || null;
  const name = fromTitle ?? fromDoc;
  if (!name) return { clientId: null, clientName: null, source: "none", created: false };

  const before = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.agencyId, agencyId));
  const client = await ensureClientByName(agencyId, name);
  if (!client) return { clientId: null, clientName: null, source: "none", created: false };

  await db
    .update(schema.jobDescriptions)
    .set({ clientId: client.id })
    .where(eq(schema.jobDescriptions.id, job.id));

  return {
    clientId: client.id,
    clientName: client.companyName,
    source: fromTitle ? "title" : "document",
    created: !before.some((c) => c.id === client.id),
  };
}
