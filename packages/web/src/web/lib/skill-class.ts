/**
 * Skill taxonomy for the UI. Re-exported from the API's pure rule module so a
 * skill chip and the match score can never disagree about whether something is
 * a real technical skill — the same function decides both.
 *
 * Only the rule half is imported here: the cache and the model fallback live in
 * `api/lib/skill-class.ts`, which pulls in Drizzle and must never reach the
 * browser bundle.
 */
export {
  classifySkillSync,
  classOf,
  coreSkills,
  isConfidentSync,
  skillKey,
  SKILL_CLASSES,
} from "../../api/lib/skill-taxonomy";
export type { SkillClass, SkillMap } from "../../api/lib/skill-taxonomy";

/** How each class reads on screen. `core` is never labelled — it is the default. */
export const SKILL_CLASS_LABEL = {
  core: "Technical",
  soft: "Soft skill",
  context: "Experience / role context",
} as const;
