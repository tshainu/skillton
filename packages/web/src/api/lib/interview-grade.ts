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

const gradedSchema = z.object({
  communication: z
    .number()
    .min(0)
    .max(10)
    .describe("Clarity, structure, listening, concision"),
  confidence: z
    .number()
    .min(0)
    .max(10)
    .describe("Composure and conviction, not volume"),
  knowledge: z
    .number()
    .min(0)
    .max(10)
    .describe("Role-relevant depth actually demonstrated"),
  professionalism: z.number().min(0).max(10),
  criticalThinking: z
    .number()
    .min(0)
    .max(10)
    .describe("Reasoning, trade-offs, problem framing"),
  responseConsistency: z
    .number()
    .min(0)
    .max(10)
    .describe("Does their story hold up across answers and CV"),
  summary: z
    .string()
    .describe("Executive summary, 3-5 sentences, evidence-led"),
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
        topic: z
          .string()
          .describe("The recruiter's question, or the topic if unscripted"),
        coverage: z
          .number()
          .min(0)
          .max(100)
          .describe("How completely the candidate answered it"),
        evidence: z
          .string()
          .describe(
            "Short verbatim quote from the candidate, or 'not answered'",
          ),
      }),
    )
    .max(12),
  redFlags: z
    .array(z.string())
    .max(6)
    .describe("Evasion, contradictions, scripted or read-aloud answers"),
  reliability: z
    .enum(["high", "medium", "low"])
    .describe(
      "Confidence in this assessment given how much the candidate actually said",
    ),
});

export type GradedInterview = z.infer<typeof gradedSchema>;

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
    const { object } = await generateObject({
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
