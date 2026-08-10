/**
 * Recruitment buckets / tags.
 *
 * Green / Yellow / Red are set by the recruiter after HR screening.
 * Blue and Purple are awarded automatically:
 *   blue   — AI interview passed above the AI-match threshold but the
 *            technical interview failed (a strong communicator worth keeping).
 *   purple — technical interview passed above the tech threshold but the
 *            client-side interview rejected them.
 * Both are "hidden gems": good people lost to a single stage.
 */

export const BUCKETS = ["green", "yellow", "red", "blue", "purple"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_LABEL: Record<Bucket, string> = {
  green: "Green — Proceed",
  yellow: "Yellow — Reconsider later",
  red: "Red — Critical red flag",
  blue: "Blue — Strong AI interview, failed technical",
  purple: "Purple — Strong technical, failed client interview",
};

export const BUCKET_SHORT: Record<Bucket, string> = {
  green: "Green",
  yellow: "Yellow",
  red: "Red",
  blue: "Blue",
  purple: "Purple",
};

/** Tailwind classes per bucket, used by every list that renders a tag. */
export const BUCKET_CLASS: Record<Bucket, string> = {
  green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  yellow: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  red: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  blue: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  purple: "bg-violet-500/15 text-violet-300 border-violet-500/30",
};

/** Reasons offered when a recruiter drops a candidate into the yellow bucket. */
export const YELLOW_REASONS = [
  "Communication issues",
  "Basic technical skill gaps",
  "Insufficient experience",
  "Other non-critical concerns",
];

/** Reasons offered when a recruiter drops a candidate into the red bucket. */
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

/** The two automatic "hidden gem" buckets. */
export const HIDDEN_GEM_BUCKETS: Bucket[] = ["blue", "purple"];
