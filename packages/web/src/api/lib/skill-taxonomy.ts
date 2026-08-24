/**
 * Skill taxonomy rules — the pure half, safe to import from the browser.
 *
 * No database and no network, so the UI, the pure scoring path and the cached
 * server-side resolver all share exactly one definition of what a skill string
 * *is*. The cache and the model fallback live in `skill-class.ts`.
 *
 *
 * Three classes, because the extracted data demanded a third:
 *
 *   core    a technology, platform, protocol, or a technical activity performed
 *           on one. Shown on every skill surface, and scored.
 *   soft    a behavioural or communication trait. Hidden from the skill chips
 *           and excluded from match scoring.
 *   context not a skill at all — seniority, years of experience, employment
 *           logistics, or a restatement of the role. Also hidden, but kept
 *           distinct from `soft` so "5 years MSP experience" is never labelled a
 *           soft skill.
 *
 * The extractor emits sentences, not tags ("Ability to work remotely during
 * Australian Eastern business hours"), and every new CV invents new strings — so
 * a fixed list cannot work alone. Classification is three layers, cheapest
 * first:
 *
 *   1. CURATED    exact match on a normalised string. Deterministic and free.
 *   2. PATTERNS   regex/keyword rules. Catches the long tail with no network.
 *   3. LLM        only for what the first two miss, and the answer is cached in
 *                 `skill_classes` forever, so each unique string costs one call
 *                 once in the lifetime of the system.
 *
 * When uncertain we return `core`. A misfiled technology that stays visible is a
 * cosmetic annoyance; a technology wrongly hidden silently loses a real match.
 */

export type SkillClass = "core" | "soft" | "context";

export const SKILL_CLASSES: readonly SkillClass[] = ["core", "soft", "context"] as const;

/** Comparison key: case, punctuation and spacing all ignored. */
export function skillKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Hand-classified strings. Every entry below is a real value in the live
 * database, confirmed with the user. Add corrections here — this layer wins over
 * both the patterns and the model.
 */
const CURATED: Record<string, SkillClass> = {};

const curate = (cls: SkillClass, items: string[]) => {
  for (const item of items) CURATED[skillKey(item)] = cls;
};

curate("soft", [
  "Analytical thinking",
  "Attention to detail",
  "Client stakeholder communication",
  "Communication",
  "Customer service via phone, email, and remote tools",
  "Explaining technical concepts clearly to non-technical users",
  "Independent work",
  "Interpersonal skills",
  "Mentoring",
  "Multitasking",
  "Problem solving",
  "Professional spoken and written English communication",
  "Professional written English communication",
  "Quick learning",
  "Remote and autonomous working",
  "Stakeholder communication and outage planning",
  "Stakeholder support",
  "Student project mentoring",
  "Supporting and mentoring less experienced help-desk team members",
  "Team collaboration",
  "Teamwork",
  "Time management",
  "Time management and prioritisation",
  "Verbal communication",
  "Written communication",
  "Judgment on when to escalate versus continue troubleshooting",
  "Telephone, email, and remote-support user support",
  "Remote customer support by telephone, email and remote-support tools",
]);

curate("context", [
  "Ability to contribute to ongoing service improvements",
  "Ability to independently learn and implement new technologies",
  "Ability to learn customer-specific applications and processes",
  "Ability to work across different customer systems, configurations and priorities",
  "Ability to work independently without step-by-step supervision",
  "Ability to work remotely during Australian Eastern business hours",
  "Autonomous work during evening/overnight shifts",
  "Level 1.5, Level 2, service-desk, or internal IT support experience",
  "Level 2 troubleshooting",
  "Level 3 systems support, senior Level 2 support, or comparable infrastructure support",
  "MSP experience supporting multiple customer environments",
  "MSP support experience",
  "Microsoft ecosystem knowledge",
  "PSA tool experience",
  "Support across multiple client environments",
  "Systems administration or similar infrastructure administration",
  "Technical support, helpdesk, or service desk support",
  "Ticketing system experience",
]);

/**
 * Explicitly `core`, against the user's original instinct. Documentation,
 * root-cause analysis and ticket handling all read like soft skills but are
 * billable MSP competencies that the JDs require by name — hiding them would
 * hide a real requirement. Confirmed with the user.
 */
curate("core", [
  "Accurate ticket-note and support-documentation maintenance",
  "Appropriate escalation of advanced server, firewall, network, infrastructure, and application issues",
  "Clear escalation summary preparation",
  "Diagnostic data collection and analysis",
  "Documentation maintenance",
  "Documentation systems",
  "Escalated-ticket ownership and resolution",
  "IT documentation creation and maintenance",
  "Incident troubleshooting",
  "Independent investigation and resolution of common technical issues",
  "Knowledge-base documentation",
  "Root-cause analysis",
  "Root-cause analysis and complex incident investigation",
  "Shift handover documentation",
  "Technical documentation and knowledge base maintenance",
  "Technical documentation and ticket management",
  "Ticket categorisation, tagging, escalation, and documentation",
  "Ticket queue management",
  "Ticketing systems",
  "Troubleshooting and root-cause analysis",
]);

/**
 * `context` patterns run before the soft-skill ones: "Ability to communicate
 * clearly" is an employment requirement phrased as an ability, and reading it as
 * a soft skill would put a sentence in the soft-skill list.
 */
const CONTEXT_PATTERNS: RegExp[] = [
  /\b(ability|willingness|prepared|able|eligible|available)\s+to\b/,
  /\b\d+\+?\s*(years?|yrs?)\b/,
  /\byears? of\b/,
  /\blevel\s*\d/,
  /\b(experience|background|exposure|knowledge)\s*(with|in|of|supporting)?\s*$/,
  /\b(or comparable|or similar|or equivalent)\b/,
  /\b(shift|shifts|overnight|business hours|time ?zone|on ?call|roster|full ?time|part ?time)\b/,
  /\b(degree|diploma|certificate|qualification)\b/,
  /\b(right to work|visa|willing to travel|driver'?s licence|drivers license)\b/,
];

const SOFT_PATTERNS: RegExp[] = [
  /\b(communication|communicating|communicate)\b/,
  /\b(teamwork|team ?player|team collaboration|collaborat\w*)\b/,
  /\b(interpersonal|people skills|soft skills)\b/,
  /\b(problem[- ]solving|analytical thinking|critical thinking|lateral thinking)\b/,
  /\b(time management|prioritis\w+|prioritiz\w+|multitask\w*|organis\w+ skills|organiz\w+ skills)\b/,
  /\b(attention to detail|detail[- ]oriented|conscientious|diligent)\b/,
  /\b(adaptab\w+|flexib\w+|resilien\w+|patien\w+|empath\w+|positive attitude|work ethic|self[- ]motivat\w+|proactive)\b/,
  /\b(mentor\w*|coach\w*|leadership|stakeholder)\b/,
  /\b(customer service|customer[- ]focused|client[- ]facing|customer care)\b/,
  /\b(spoken|verbal|written)\s+english\b/,
  /\benglish (language|proficiency|fluency)\b/,
  /\b(quick learn\w*|fast learn\w*|eager to learn|willing to learn)\b/,
];

/**
 * A technology token anywhere in the string forces `core`, even when a soft
 * pattern also fires: "Stakeholder communication about Azure outages" is really
 * about Azure. Deliberately conservative — brands and protocols only.
 */
const TECH_TOKENS =
  /\b(cisco|meraki|juniper|ubiquiti|unifi|ruckus|sophos|fortinet|palo alto|windows|linux|debian|ubuntu|proxmox|vmware|hyper-?v|azure|aws|gcp|microsoft|office|exchange|sharepoint|onedrive|teams|intune|entra|active directory|powershell|python|bash|sql|dns|dhcp|vlan|vpn|ospf|bgp|nat|pat|tcp|ip|radius|firewall|router|switch\w*|server|backup|veeam|datto|kaseya|connectwise|autotask|ninjaone|sentinelone|threatlocker|blackpoint|immybot|rewst|cloudflare|3cx|sip|voip|hardware|ssd|ram|idrac|supermicro|dell|printer|virtualis\w+|virtualiz\w+|rmm|mdm|siem|sso|mfa|patch\w*|scripting|coding|programming|automation|migration|monitoring|networking|infrastructure|endpoint|vulnerabilit\w+|wi ?-?fi|wifi|wireless|ticketing|documentation|troubleshoot\w*|root[- ]cause|diagnostic\w*|escalat\w*)\b/;

/**
 * Synchronous best guess — curated, then patterns. Never touches the network, so
 * the UI and the pure scoring path can both call it. Returns `core` when nothing
 * matches, which is the deliberate fail-open direction.
 */
export function classifySkillSync(raw: string): SkillClass {
  const key = skillKey(raw);
  if (!key) return "core";
  const curated = CURATED[key];
  if (curated) return curated;
  if (TECH_TOKENS.test(key)) return "core";
  if (CONTEXT_PATTERNS.some((re) => re.test(key))) return "context";
  if (SOFT_PATTERNS.some((re) => re.test(key))) return "soft";
  return "core";
}

/** True when the synchronous layers actually knew, rather than falling back. */
export function isConfidentSync(raw: string): boolean {
  const key = skillKey(raw);
  if (!key) return true;
  return (
    key in CURATED ||
    TECH_TOKENS.test(key) ||
    CONTEXT_PATTERNS.some((re) => re.test(key)) ||
    SOFT_PATTERNS.some((re) => re.test(key))
  );
}

export type SkillMap = ReadonlyMap<string, SkillClass>;

/** Look one skill up in a resolved map, falling back to the sync guess. */
export function classOf(raw: string, classes: SkillMap): SkillClass {
  return classes.get(skillKey(raw)) ?? classifySkillSync(raw);
}

/** Keep only the skills that count — the shared filter for every surface. */
export function coreSkills(list: readonly string[] | null | undefined, classes?: SkillMap): string[] {
  return (list ?? []).filter((s) => (classes ? classOf(s, classes) : classifySkillSync(s)) === "core");
}
