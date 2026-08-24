/**
 * Skill taxonomy — cache and model fallback over the pure rules in
 * `skill-taxonomy.ts`.
 *
 * The extractor emits sentences, not tags ("Ability to work remotely during
 * Australian Eastern business hours"), and every new CV invents new strings, so
 * a fixed list cannot work alone. Three layers, cheapest first: the curated map,
 * then the regex rules, then one model call for whatever is genuinely unknown —
 * cached in `skill_classes` forever, so each unique string costs one call once in
 * the lifetime of the system.
 */
import { inArray } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import {
  classifySkillSync,
  isConfidentSync,
  skillKey,
  SKILL_CLASSES,
  type SkillClass,
  type SkillMap,
} from "./skill-taxonomy";

export * from "./skill-taxonomy";

/**
 * Resolve a batch of skill strings to their classes: cache, then the sync
 * layers, then one model call for whatever is genuinely unknown. Safe to call
 * with duplicates and with strings already seen.
 */
export async function resolveSkillClasses(raw: readonly string[]): Promise<SkillMap> {
  const out = new Map<string, SkillClass>();
  const keys = [...new Set(raw.map(skillKey).filter(Boolean))];
  if (!keys.length) return out;

  const unresolved: string[] = [];
  const byKey = new Map<string, string>();
  for (const item of raw) {
    const key = skillKey(item);
    if (key && !byKey.has(key)) byKey.set(key, item.trim());
  }

  const CHUNK = 200;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const cached = await db
      .select()
      .from(schema.skillClasses)
      .where(inArray(schema.skillClasses.skillKey, slice));
    for (const row of cached) out.set(row.skillKey, row.skillClass as SkillClass);
  }

  for (const key of keys) {
    if (out.has(key)) continue;
    const label = byKey.get(key) ?? key;
    if (isConfidentSync(label)) {
      out.set(key, classifySkillSync(label));
      continue;
    }
    unresolved.push(label);
  }

  if (unresolved.length) {
    const learned = await classifyWithModel(unresolved);
    for (const [label, cls] of learned) out.set(skillKey(label), cls);
    await cacheClasses(learned, "llm");
  }

  return out;
}

/** Persist decisions so a string is only ever classified once. */
async function cacheClasses(entries: Iterable<[string, SkillClass]>, source: string) {
  const rows = [...entries]
    .map(([label, cls]) => ({
      skillKey: skillKey(label),
      label: label.trim().slice(0, 300),
      skillClass: cls,
      source,
    }))
    .filter((r) => r.skillKey);
  if (!rows.length) return;
  try {
    await db
      .insert(schema.skillClasses)
      .values(rows)
      .onConflictDoNothing({ target: schema.skillClasses.skillKey });
  } catch {
    /* The cache is an optimisation — never fail a match run over it. */
  }
}

/**
 * Ask the model only about strings the rules could not place. Any failure falls
 * back to `core` for the whole batch, and nothing is cached, so a transient
 * gateway error cannot permanently mislabel a skill.
 */
async function classifyWithModel(labels: string[]): Promise<Map<string, SkillClass>> {
  const out = new Map<string, SkillClass>();
  try {
    const { classifySkillStrings } = await import("./ai-extract");
    const answer = await classifySkillStrings(labels);
    for (const item of answer) {
      if (SKILL_CLASSES.includes(item.class)) out.set(item.skill, item.class);
    }
  } catch {
    /* Fall through — unresolved strings stay `core`, the fail-open default. */
  }
  for (const label of labels) if (!out.has(label)) out.set(label, "core");
  return out;
}

/** Manual reclassification, used by the admin surface. Overrides everything. */
export async function setSkillClass(label: string, cls: SkillClass) {
  const key = skillKey(label);
  if (!key) return;
  await db
    .insert(schema.skillClasses)
    .values({ skillKey: key, label: label.trim().slice(0, 300), skillClass: cls, source: "manual" })
    .onConflictDoUpdate({
      target: schema.skillClasses.skillKey,
      set: { skillClass: cls, source: "manual", updatedAt: new Date() },
    });
}
