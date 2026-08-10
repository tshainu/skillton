import { Meter } from "../ui/score";
import type { AiAssessment } from "../../../api/database/schema";

/**
 * The six assessment dimensions of an AI interview.
 *
 * Rendering is driven by this explicit list rather than `Object.entries` on the
 * stored assessment: that object also carries the per-dimension `notes`, which
 * would otherwise appear as a seventh, meaningless bar. The fixed order also
 * keeps every report comparable at a glance.
 */
const DIMENSIONS = [
  { key: "communication", label: "Communication", hint: "Structure, clarity, concision" },
  { key: "confidence", label: "Confidence", hint: "Composure and conviction" },
  { key: "knowledge", label: "Knowledge", hint: "Role-relevant depth shown" },
  { key: "professionalism", label: "Professionalism", hint: "Conduct in the interview" },
  { key: "criticalThinking", label: "Critical Thinking", hint: "Reasoning and trade-offs" },
  { key: "responseConsistency", label: "Response Consistency", hint: "Story holds up vs the CV" },
] as const;

/**
 * The dimensions of one assessment as display rows. Everything that renders an
 * assessment — bars, radar chart, printable table — goes through this, so the
 * `notes` key can never leak in as a bogus dimension.
 */
export function assessmentRows(assessment: AiAssessment) {
  return DIMENSIONS.filter((d) => typeof assessment[d.key] === "number").map((d) => ({
    key: d.key,
    label: d.label,
    hint: d.hint,
    value: assessment[d.key] as number,
    note: assessment.notes?.[d.key] ?? null,
  }));
}

/** Colour by band, so a weak dimension reads as weak without reading the number. */
function bandColor(score: number): string {
  if (score >= 7) return "var(--color-success)";
  if (score >= 5) return "var(--color-warning)";
  return "var(--color-destructive)";
}

export function AssessmentBars({
  assessment,
  showNotes = false,
  className,
}: {
  assessment: AiAssessment;
  /** Full report shows the evidence behind each score; list cards do not. */
  showNotes?: boolean;
  className?: string;
}) {
  const scores = DIMENSIONS.map((d) => assessment[d.key]).filter((n) => typeof n === "number");
  const spread = scores.length ? Math.max(...scores) - Math.min(...scores) : 0;

  return (
    <div className={className}>
      <div className={`grid gap-x-5 gap-y-2.5 ${showNotes ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
        {DIMENSIONS.map((d) => {
          const value = assessment[d.key];
          if (typeof value !== "number") return null;
          const note = assessment.notes?.[d.key];
          return (
            <div key={d.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-muted-foreground" title={d.hint}>
                  {d.label}
                </span>
                <span className="num text-[10.5px] font-medium text-foreground/80">{value}/10</span>
              </div>
              <Meter value={value} max={10} color={bandColor(value)} />
              {showNotes && note && (
                <p className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-muted-foreground/80">{note}</p>
              )}
            </div>
          );
        })}
      </div>
      {/* A flat grade is a grading failure, not a result — the recruiter should
          know the report is not telling them anything differentiating. */}
      {showNotes && scores.length === DIMENSIONS.length && spread === 0 && (
        <p className="mt-2.5 text-[11px] text-warning">
          Every dimension scored the same. Re-grade the transcript for a more differentiated read.
        </p>
      )}
    </div>
  );
}
