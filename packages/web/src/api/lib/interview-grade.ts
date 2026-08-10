import { z } from "zod";
import { generateObject } from "ai";
import dedent from "dedent";
import { gateway, REASON_MODEL } from "../agent/gateway";
import type { AiQuestion, TranscriptTurn } from "../database/schema";

/**
 * Grading for the AI screening interview.
 *
 * Accuracy rules that this module exists to enforce:
 *  - grade with the reasoning model, not the cheap extraction model;
 *  - grade against the recruiter's actual question set, so topic coverage is
 *    measured rather than invented;
 *  - judge only what the CANDIDATE said — the interviewer's own words are
 *    context, never evidence;
 *  - refuse to score a transcript that is too thin to support a judgement, and
 *    say so, instead of emitting confident numbers from three sentences;
 *  - hand the integrity signals to the grader so a candidate who spent the
 *    interview off-screen cannot quietly score like one who did not.
 */

/** Anchored rubric. Without it the model drifts to "everything is a 7". */
const RUBRIC = dedent`
  SCORING RUBRIC — apply per dimension, 0-10:
    0-2  No usable evidence, or evidence directly contradicts the dimension.
    3-4  Weak: vague, generic, or textbook answers with no specifics.
    5-6  Adequate: answers the question but stays shallow; few concrete details.
    7-8  Strong: specific examples, own contribution clear, trade-offs explained.
    9-10 Exceptional: quantified outcomes, honest about failure, reasoned depth
         under follow-up pressure.
  A dimension with no supporting candidate speech scores 0-2 and must be called
  out in the summary. Never average toward the middle to be polite.
`;

/**
 * The six dimensions measure genuinely different things, and the grader has to
 * be told so explicitly. Left to itself the model forms one overall impression
 * of the candidate and then writes that same number into all six boxes — the
 * halo effect — which produced reports reading 3/4/4/3/3/3 where the bars all
 * looked identical and told the recruiter nothing.
 *
 * Two mechanisms break the halo:
 *  1. each dimension is defined by what it does NOT cover, so they cannot be
 *     collapsed into "how good was this candidate";
 *  2. each score must carry its own quote from the candidate, which forces the
 *     model to look at different parts of the transcript per dimension instead
 *     of scoring once and copying.
 */
const DIMENSION_GUIDE = dedent`
  THE SIX DIMENSIONS ARE INDEPENDENT — SCORE THEM SEPARATELY:

  · communication — HOW they said it: structure, clarity, concision, whether
    they answered the actual question. Ignore whether the content was correct.
    A confidently wrong answer delivered clearly still scores well here.
  · confidence — composure and conviction: do they commit to an answer, own
    their decisions, admit a gap without crumbling. Ignore correctness and
    ignore fluency. Nervous but substantive is not low confidence; breezy and
    hollow is not high confidence.
  · knowledge — role-relevant technical or domain depth they actually
    demonstrated. Ignore delivery entirely. Halting, awkward speech describing
    a real system in accurate detail scores HIGH here.
  · professionalism — conduct in the interview: punctual engagement, respectful
    tone, taking the process seriously, no discrediting of past employers or
    colleagues. Ignore skill level completely. A weak candidate who behaves well
    scores high here; this is usually the dimension least correlated with the
    others.
  · criticalThinking — reasoning quality: how they frame a problem, weigh
    trade-offs, diagnose a cause, reason about something they have not seen
    before. Ignore whether they knew the fact; judge how they thought.
  · responseConsistency — does their story hold together: answers against each
    other, and answers against the CV. A candidate whose CV claims five years of
    a technology they cannot discuss scores LOW here regardless of how well the
    rest of the interview went. This dimension is about contradictions only.

  ANTI-HALO RULE — READ TWICE: Do NOT form an overall impression and copy it into
  all six scores. Judge each dimension only against its own definition above and
  its own evidence. Identical or near-identical scores across all six dimensions
  are almost always a grading failure, not a real result — real candidates are
  uneven, typically spanning 3 or more points between their best and worst
  dimension. Before you finish, check your six numbers: if they are all the same
  or within one point of each other, you have not actually graded them
  separately. Go back and re-score each one against its own definition and its
  own quote. Only leave them clustered if the transcript genuinely forces it, and
  say so in the summary.

  Each dimension needs its own \`evidence\`: a short quote or close paraphrase of
  what the CANDIDATE said that drove that specific number. Different dimensions
  should generally cite different moments. If a dimension has nothing to stand
  on, write "no evidence" and score it 0-2.
`;

/** One scored dimension plus the candidate speech that justifies it. */
function dimension(what: string) {
  return z
    .object({
      score: z.number().min(0).max(10),
      evidence: z
        .string()
        .describe(
          "Short quote or close paraphrase of the CANDIDATE's own words that justifies THIS score, or 'no evidence'",
        ),
    })
    .describe(what);
}

const gradedSchema = z.object({
  communication: dimension("HOW they spoke: structure, clarity, concision. Not correctness."),
  confidence: dimension("Composure and conviction. Not fluency, not correctness."),
  knowledge: dimension("Role-relevant depth demonstrated. Ignore delivery quality."),
  professionalism: dimension("Conduct and seriousness in the interview. Ignore skill level."),
  criticalThinking: dimension("Reasoning, trade-offs, problem framing. Not recall."),
  responseConsistency: dimension("Contradictions across answers and against the CV. Nothing else."),
  summary: z.string().describe("Executive summary, 3-5 sentences, evidence-led"),
  strengths: z
    .array(z.string())
    .max(6)
    .describe("Each grounded in something the candidate said"),
  weaknesses: z.array(z.string()).max(6),
  suggestedTechFocus: z
    .array(z.string())
    .max(6)
    .describe("What the technical round must probe and why"),
  selectionReason: z
    .string()
    .describe("One paragraph: advance or not, and on what evidence"),
  topicCoverage: z
    .array(
      z.object({
        topic: z.string().describe("The recruiter's question, or the topic if unscripted"),
        coverage: z.number().min(0).max(100).describe("How completely the candidate answered it"),
        evidence: z.string().describe("Short verbatim quote from the candidate, or 'not answered'"),
      }),
    )
    .max(12),
  redFlags: z
    .array(z.string())
    .max(6)
    .describe("Evasion, contradictions, scripted or read-aloud answers"),
  reliability: z
    .enum(["high", "medium", "low"])
    .describe("Confidence in this assessment given how much the candidate actually said"),
});

export type GradedInterview = z.infer<typeof gradedSchema>;

/** The six dimension keys, in the order the report displays them. */
export const ASSESSMENT_DIMENSIONS = [
  "communication",
  "confidence",
  "knowledge",
  "professionalism",
  "criticalThinking",
  "responseConsistency",
] as const;

export type AssessmentDimension = (typeof ASSESSMENT_DIMENSIONS)[number];

/**
 * Flattens the graded dimensions into the shape stored on the interview row:
 * six numbers, plus the per-dimension evidence under `notes` so the report can
 * show why each score is what it is. `assessment` is a JSON column, so the extra
 * key needs no migration and older rows simply have no notes.
 */
export function toStoredAssessment(graded: GradedInterview) {
  const notes: Partial<Record<AssessmentDimension, string>> = {};
  for (const key of ASSESSMENT_DIMENSIONS) {
    const note = graded[key].evidence?.trim();
    if (note) notes[key] = note;
  }
  return {
    communication: graded.communication.score,
    confidence: graded.confidence.score,
    knowledge: graded.knowledge.score,
    professionalism: graded.professionalism.score,
    criticalThinking: graded.criticalThinking.score,
    responseConsistency: graded.responseConsistency.score,
    notes,
  };
}

/** Spread between the best and worst dimension — how differentiated a grade is. */
export function assessmentSpread(graded: GradedInterview): number {
  const scores = ASSESSMENT_DIMENSIONS.map((k) => graded[k].score);
  return Math.max(...scores) - Math.min(...scores);
}

export interface GradeInput {
  transcript: TranscriptTurn[];
  questions: AiQuestion[];
  questionSetTitle?: string | null;
  jobTitle?: string | null;
  jobSkills?: string[];
  candidateHeadline?: string | null;
  candidateExperienceYears?: number | null;
  candidateSkills?: string[];
  durationSeconds?: number | null;
  integrity?: string | null;
}

export interface GradeResult {
  graded: GradedInterview | null;
  /** Why grading was skipped, when it was. */
  skipped?: string;
  candidateWords: number;
}

/** Words the candidate actually contributed — the only real basis for a score. */
export function candidateWordCount(transcript: TranscriptTurn[]): number {
  return transcript
    .filter((t) => t.role !== "ai")
    .map((t) => t.text.trim())
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Absolute floor. With fewer candidate words than this there is literally
 * nothing to read, so no numbers are emitted at all.
 */
const MIN_GRADABLE_WORDS = 10;

/**
 * Below this the transcript is thin: the recruiter still gets the full report
 * — scores, dimensions, coverage, tech focus — because a short interview is
 * itself a signal they need to see, but the grader is told to treat it as
 * limited evidence and reliability is forced to "low".
 */
const THIN_TRANSCRIPT_WORDS = 60;

/**
 * Minimum acceptable gap between the best and worst dimension. Below this the
 * grade is treated as un-differentiated (the halo effect) and re-scored once.
 */
const MIN_DIMENSION_SPREAD = 2;

export async function gradeInterview(input: GradeInput): Promise<GradeResult> {
  const words = candidateWordCount(input.transcript);
  if (words < MIN_GRADABLE_WORDS) {
    return {
      graded: null,
      candidateWords: words,
      skipped: `The candidate said almost nothing (${words} word${words === 1 ? "" : "s"} captured), so there is nothing to assess. Re-run the interview or review the recording.`,
    };
  }
  const thin = words < THIN_TRANSCRIPT_WORDS;

  const dialogue = input.transcript
    .map((t) => `${t.role === "ai" ? "INTERVIEWER" : "CANDIDATE"}: ${t.text}`)
    .join("\n");

  const scriptedQuestions = input.questions.length
    ? input.questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")
    : "(No scripted set — the interviewer used the default screening topics.)";

  try {
    const { object: first } = await generateObject({
      model: gateway(REASON_MODEL),
      schema: gradedSchema,
      prompt: dedent`
        You are a senior recruitment assessor grading a first-round AI screening
        interview. Your output drives a real hiring decision, so it must be
        strictly evidence-based.

        HARD RULES
        - Judge ONLY the CANDIDATE lines. The INTERVIEWER lines are context. Never
          credit the candidate for something the interviewer said or implied.
        - Every strength, weakness and red flag must trace to something the
          candidate actually said. Quote or paraphrase it. Invent nothing.
        - Score topic coverage against the recruiter's numbered questions below.
          A question the interviewer never asked is coverage 0 with evidence
          "not asked". A question asked but dodged is low coverage with the
          dodge as evidence.
        - Do not reward fluency alone. Confident vagueness scores low on
          knowledge and critical thinking.
        - Set reliability to "low" if the candidate said little, answers were
          cut short, or the integrity notes show they were off-screen for a
          meaningful part of the interview.
        - Always fill every field. If a dimension has no evidence, score it 0-2
          and say so — never leave the report empty.
        ${
          thin
            ? dedent`
        - THIN TRANSCRIPT: the candidate spoke very little. Score what is there,
          keep every unevidenced dimension at 0-2, open the summary by stating
          plainly that the interview was too short to assess properly and should
          be re-run, and set reliability to "low".`
            : ""
        }

        ${RUBRIC}

        ${DIMENSION_GUIDE}

        POSITION: ${input.jobTitle ?? "General screening"}
        ROLE REQUIREMENTS: ${(input.jobSkills ?? []).slice(0, 20).join(", ") || "not specified"}
        CANDIDATE ON PAPER: ${input.candidateHeadline ?? "unknown"} — ${input.candidateExperienceYears ?? "?"} years; CV lists ${(input.candidateSkills ?? []).slice(0, 20).join(", ") || "nothing parsed"}
        INTERVIEW LENGTH: ${input.durationSeconds ? `${Math.round(input.durationSeconds / 60)} min` : "unknown"}; candidate spoke ~${words} words.
        INTEGRITY NOTES: ${input.integrity ?? "none"}

        RECRUITER'S QUESTION SET${input.questionSetTitle ? ` — ${input.questionSetTitle}` : ""}:
        ${scriptedQuestions}

        TRANSCRIPT:
        ${dialogue.slice(0, 24000)}
      `,
    });
    /* Prompting alone does not reliably beat the halo effect, so the spread is
       checked and one re-score is forced when the six numbers came back flat.
       A genuinely uniform candidate survives this: the second pass is allowed to
       return the same numbers, it just has to do so deliberately. */
    let object = first;
    if (!thin && assessmentSpread(object) < MIN_DIMENSION_SPREAD) {
      const flat = ASSESSMENT_DIMENSIONS.map((k) => `${k}=${object[k].score}`).join(", ");
      try {
        const { object: second } = await generateObject({
          model: gateway(REASON_MODEL),
          schema: gradedSchema,
          prompt: dedent`
            Re-score this interview. Your previous attempt returned ${flat} — the
            six dimensions are within ${assessmentSpread(object)} point(s) of each
            other, which means you formed one overall impression of the candidate
            and copied it into every box instead of grading the dimensions
            separately.

            Score each dimension ONLY against its own definition and its own
            evidence, as set out below. Look at a different part of the transcript
            for each one. Professionalism (conduct) and responseConsistency
            (contradictions) in particular have almost nothing to do with
            knowledge or communication — they are usually the dimensions that
            differ most.

            If after genuinely re-scoring them the numbers really are uniform,
            keep them and say explicitly in the summary why this candidate is
            equally strong or weak on every dimension.

            ${RUBRIC}

            ${DIMENSION_GUIDE}

            POSITION: ${input.jobTitle ?? "General screening"}
            CANDIDATE ON PAPER: ${input.candidateHeadline ?? "unknown"} — ${input.candidateExperienceYears ?? "?"} years; CV lists ${(input.candidateSkills ?? []).slice(0, 20).join(", ") || "nothing parsed"}
            INTEGRITY NOTES: ${input.integrity ?? "none"}

            RECRUITER'S QUESTION SET:
            ${scriptedQuestions}

            TRANSCRIPT:
            ${dialogue.slice(0, 24000)}
          `,
        });
        /* Keep the re-score only if it actually differentiated. */
        if (assessmentSpread(second) > assessmentSpread(object)) object = second;
      } catch {
        /* The first grade stands — a flat report beats no report. */
      }
    }

    /* A thin transcript can never be reported as a confident read, whatever the
       model claims about itself. */
    const graded: GradedInterview = thin
      ? {
          ...object,
          reliability: "low",
          summary: `Only ${words} words of candidate speech were captured, so treat these scores as indicative and re-run the interview before deciding. ${object.summary}`,
        }
      : object;
    return { graded, candidateWords: words };
  } catch (error) {
    return {
      graded: null,
      candidateWords: words,
      skipped: `Automatic grading failed (${(error as Error).message.slice(0, 120)}). The transcript is saved — regrade from the interview report.`,
    };
  }
}
