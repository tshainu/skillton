/**
 * Turns a pasted block of interview questions into structured
 * question + follow-up pairs, so a whole set can be built from one paste
 * instead of typing every field.
 *
 * Understood shapes (mix freely):
 *   1. Main question
 *      - follow up one
 *      - follow up two
 *   Q2) Main question | follow up one | follow up two
 *   Question 3: Main question
 *      Follow-ups: one; two
 *   • Main question            (flat bullet list, no follow-ups)
 *       indented follow up     (indentation alone marks a follow-up)
 */

export interface ParsedQuestion {
  question: string;
  followUps: string[];
}

/** "1." "1)" "2 -" "Q3:" "Question 4 -" "#5" */
const QUESTION_MARKER = /^(?:#\s*)?(?:q(?:uestion)?\s*)?(\d{1,3})\s*(?:[.)\]:>-]|\s)\s*(.*)$/i;
/** "Follow-up:" "Follow ups -" "Probe:" "Probing questions:" */
const FOLLOWUP_LABEL =
  /^(?:follow[\s-]?ups?|probes?|probing(?:\s+questions?)?|sub[\s-]?questions?)\s*(?:questions?)?\s*[:\-–]\s*(.*)$/i;
/** "- " "* " "• " "– " "> " "↳ " "a) " "a. " "i. " "1.1 " */
const BULLET_MARKER = /^(?:[-*•·–—>→↳+]|(?:[a-z]|i{1,3}|iv|v)[.)]|\d+\.\d+)\s+(.*)$/i;
/** Splits several follow-ups written on one line. */
const INLINE_SPLIT = /\s*(?:\||;|\/{2,})\s*/;

const MIN_INDENT_FOR_FOLLOWUP = 2;

export function parseQuestionBlock(raw: string): ParsedQuestion[] {
  const out: ParsedQuestion[] = [];
  let sawNumbering = false;

  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) continue;

    const indent = line.length - line.trimStart().length;
    let body = line.trim();
    let isFollowUp = false;
    let numbered = false;

    // Explicit "Follow-ups: a; b" line.
    const label = FOLLOWUP_LABEL.exec(body);
    if (label) {
      body = (label[1] ?? "").trim();
      isFollowUp = true;
    }

    if (!isFollowUp) {
      const numberMatch = QUESTION_MARKER.exec(body);
      if (numberMatch && (numberMatch[2] ?? "").trim()) {
        body = (numberMatch[2] ?? "").trim();
        numbered = true;
      } else {
        const bullet = BULLET_MARKER.exec(body);
        if (bullet) {
          body = (bullet[1] ?? "").trim();
          // A bullet counts as a follow-up only when a question is already open
          // and it is either indented or the block numbers its main questions.
          isFollowUp = out.length > 0 && (indent >= MIN_INDENT_FOR_FOLLOWUP || sawNumbering);
        } else if (out.length > 0 && indent >= MIN_INDENT_FOR_FOLLOWUP) {
          isFollowUp = true;
        }
      }
    }

    const parts = body
      .split(INLINE_SPLIT)
      .map((part) => clean(part))
      .filter(Boolean);
    if (!parts.length) continue;

    const open = out.at(-1);
    if (isFollowUp && open) {
      open.followUps.push(...parts);
      continue;
    }

    const [question, ...inlineFollowUps] = parts;
    out.push({ question: question as string, followUps: inlineFollowUps });
    if (numbered) sawNumbering = true;
  }

  return out.filter((entry) => entry.question.length > 0);
}

function clean(value: string) {
  return value
    .trim()
    .replace(/^\*\*(.*)\*\*$/s, "$1")
    .replace(/^["“”'`]+|["“”'`]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
