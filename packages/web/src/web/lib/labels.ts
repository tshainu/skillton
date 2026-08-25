/**
 * Human labels shared by every dropdown, table and badge.
 *
 * Statuses are stored as snake_case; anywhere one is shown to a user it goes
 * through `titleCase` so the first letter is always capitalised.
 */

const ACRONYMS: Record<string, string> = {
  hr: "HR",
  ai: "AI",
  cv: "CV",
  jd: "JD",
  nic: "NIC",
  sla: "SLA",
  ceo: "CEO",
};

/** "ai_interview_pending" -> "AI interview pending". */
export function titleCase(value: string | null | undefined): string {
  if (!value) return "";
  const words = value.replace(/[_-]+/g, " ").trim().split(/\s+/);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      if (index === 0) return lower.charAt(0).toUpperCase() + lower.slice(1);
      return lower;
    })
    .join(" ");
}

/** Every word capitalised — used for names of things, not sentences. */
export function startCase(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase();
      return ACRONYMS[lower] ?? lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/* ---------------------------------------------------------------- buckets */

export const BUCKETS = ["green", "yellow", "red", "blue", "purple"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_LABEL: Record<Bucket, string> = {
  green: "Green — Proceed",
  yellow: "Yellow — Reconsider later",
  red: "Red — Critical red flag",
  blue: "Blue — Strong AI interview, failed technical",
  purple: "Purple — Strong technical, failed client",
};

export const BUCKET_CLASS: Record<Bucket, string> = {
  green: "border-emerald-500/35 bg-emerald-500/12 text-emerald-300",
  yellow: "border-amber-500/35 bg-amber-500/12 text-amber-300",
  red: "border-rose-500/35 bg-rose-500/12 text-rose-300",
  blue: "border-sky-500/35 bg-sky-500/12 text-sky-300",
  purple: "border-violet-500/35 bg-violet-500/12 text-violet-300",
};

export const YELLOW_REASONS = [
  "Communication issues",
  "Basic technical skill gaps",
  "Insufficient experience",
  "Other non-critical concerns",
];

export const RED_REASONS = [
  "Not willing to work on contract",
  "Salary expectations outside range",
  "Migration or relocation issues",
  "Work authorization issues",
  "Unacceptable behaviour or professionalism",
  "Other major hiring risk",
];

export function isBucket(value: string | null | undefined): value is Bucket {
  return !!value && (BUCKETS as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------- sources */

export const CANDIDATE_SOURCES = [
  "website",
  "linkedin",
  "referral",
  "job_portal",
  "facebook",
  "manual",
  "university",
  "database",
] as const;

export const SOURCE_LABEL: Record<string, string> = {
  website: "Website",
  linkedin: "LinkedIn",
  referral: "Referral",
  job_portal: "Job portal",
  facebook: "Facebook",
  manual: "Manual upload",
  university: "University",
  database: "Agency database",
};

export function formatNumber(value: number | null | undefined, suffix = ""): string {
  if (value == null || Number.isNaN(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString()}${suffix}`;
}

/**
 * How stale an expired score is, as a band rather than a date.
 *
 * A recruiter looking at an expired score does not need to know it lapsed on
 * 14 Feb — they need to know whether it is worth re-running or whether the CV
 * itself is now too old to trust. Bands answer that in one glance; the exact
 * date is still available when the row is expanded.
 */
export function staleBandLabel(value: Date | string | null | undefined): string {
  if (!value) return "Expired";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Expired";
  const months = (Date.now() - date.getTime()) / (30 * 86_400_000);
  if (months >= 12) return "> 1 year";
  if (months >= 6) return "> 6 months";
  if (months >= 3) return "> 3 months";
  if (months >= 1) return "> 1 month";
  return "< 1 month";
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
