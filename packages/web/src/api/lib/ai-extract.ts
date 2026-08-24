import { generateObject, generateText } from "ai";
import { z } from "zod";
import dedent from "dedent";
import { gateway, PARSE_MODEL, REASON_MODEL } from "../agent/gateway";
import type { ParsedJd } from "../database/schema";

/* ------------------------------------------------------------------ schemas */

const cvSchema = z.object({
  firstName: z.string().describe("Candidate first name; 'Unknown' if absent"),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  nic: z
    .string()
    .nullable()
    .describe("National identity card / passport number if printed on the CV, else null"),
  location: z.string().nullable().describe("City, Country"),
  headline: z.string().nullable().describe("Current title / one-line professional summary"),
  experienceYears: z.number().nullable().describe("Total years of professional experience"),
  skills: z.array(z.string()).describe("Soft + hard skills"),
  technologies: z.array(z.string()).describe("Languages, frameworks, tools, platforms"),
  education: z.array(z.string()).describe("e.g. 'BSc Computer Science, University of Colombo, 2019'"),
  certifications: z.array(z.string()),
  languages: z.array(z.string()),
  projects: z.array(z.string()).describe("Short project descriptions"),
});

const jdSchema = z.object({
  summary: z.string(),
  companyName: z
    .string()
    .nullable()
    .describe(
      "The hiring company the role is for. Null unless the document names it — never guess, and never return the recruitment agency's own name.",
    ),
  skills: z.array(z.string()).describe("Required skills stated in the document"),
  technologies: z.array(z.string()),
  certifications: z.array(z.string()),
  minExperienceYears: z.number().nullable(),
  education: z.string().nullable(),
  responsibilities: z.array(z.string()),
  softSkills: z.array(z.string()),
  location: z.string().nullable(),
});

const explainSchema = z.object({
  explanation: z.string().describe("2-4 sentences on why this candidate fits or does not"),
  strengths: z.array(z.string()).max(6),
  recommendedFocusAreas: z.array(z.string()).max(6).describe("What the technical interview should probe"),
});

export type ParsedCv = z.infer<typeof cvSchema>;

/* ------------------------------------------------------------- heuristics */

const KNOWN_TECH = [
  "javascript","typescript","react","angular","vue","svelte","node","nodejs","bun","deno","python","django","flask",
  "fastapi","java","spring","kotlin","swift","objective-c","go","golang","rust","c++","c#",".net","php","laravel",
  "symfony","ruby","rails","sql","postgresql","mysql","sqlite","mongodb","redis","elasticsearch","kafka","rabbitmq",
  "docker","kubernetes","terraform","ansible","aws","azure","gcp","jenkins","github actions","gitlab ci","graphql",
  "rest","grpc","tailwind","sass","figma","git","linux","nginx","apache","pandas","numpy","pytorch","tensorflow",
  "scikit-learn","spark","hadoop","airflow","dbt","tableau","power bi","salesforce","sap","selenium","cypress",
  "jest","playwright","flutter","react native","android","ios","unity","solidity","next.js","nuxt","express",
];

const KNOWN_SOFT = [
  "communication","leadership","teamwork","problem solving","time management","adaptability","mentoring",
  "stakeholder management","negotiation","presentation","critical thinking","collaboration","ownership",
];

function heuristicList(text: string, vocabulary: string[]): string[] {
  const lower = text.toLowerCase();
  return vocabulary.filter((term) => lower.includes(term));
}

function heuristicEmail(text: string): string | null {
  return text.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/)?.[0] ?? null;
}

function heuristicPhone(text: string): string | null {
  return text.match(/(\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() ?? null;
}

function heuristicYears(text: string): number | null {
  const match = text.match(/(\d{1,2}(?:\.\d)?)\+?\s*(?:years?|yrs?)\s*(?:of\s*)?(?:professional\s*)?experience/i);
  if (match) return Number(match[1]);
  const years = [...text.matchAll(/(19|20)\d{2}/g)].map((m) => Number(m[0])).filter((y) => y >= 1980 && y <= 2100);
  if (years.length >= 2) {
    const span = Math.max(...years) - Math.min(...years);
    if (span > 0 && span < 45) return span;
  }
  return null;
}

function heuristicName(text: string, filename: string): { firstName: string; lastName: string | null } {
  const firstLines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 4);
  for (const line of firstLines) {
    if (line.length > 45 || /@|\d|curriculum|resume|cv\b/i.test(line)) continue;
    const words = line.split(/\s+/).filter((w) => /^[A-Z][a-zA-Z'.-]+$/.test(w));
    if (words.length >= 2) return { firstName: words[0]!, lastName: words.slice(1).join(" ") };
  }
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\b(cv|resume)\b/gi, "").trim();
  const parts = stem.split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "Unknown", lastName: parts.slice(1).join(" ") || null };
}

/* ------------------------------------------------------------------ parsers */

/** Parse a CV. Uses the LLM, falls back to heuristics so bulk upload never blocks. */
export async function parseCv(text: string, filename: string): Promise<ParsedCv> {
  const body = text.slice(0, 18000);
  try {
    const { object } = await generateObject({
      model: gateway(PARSE_MODEL),
      schema: cvSchema,
      prompt: dedent`
        Extract structured data from this CV/resume. Use only what the document states —
        never invent skills, employers or dates. Normalize technology names to their
        common form (e.g. "ReactJS" -> "React").

        FILE: ${filename}

        CV TEXT:
        ${body}
      `,
    });
    if (object.firstName && object.firstName.toLowerCase() !== "unknown") return object;
    const guess = heuristicName(text, filename);
    return { ...object, firstName: guess.firstName, lastName: object.lastName ?? guess.lastName };
  } catch {
    const name = heuristicName(text, filename);
    return {
      firstName: name.firstName,
      lastName: name.lastName,
      email: heuristicEmail(text),
      phone: heuristicPhone(text),
      nic: null,
      location: null,
      headline: null,
      experienceYears: heuristicYears(text),
      skills: heuristicList(text, KNOWN_SOFT),
      technologies: heuristicList(text, KNOWN_TECH),
      education: [],
      certifications: [],
      languages: [],
      projects: [],
    };
  }
}

/** Parse a JD document — the JD document is the only source used for matching. */
export async function parseJd(text: string, title: string): Promise<ParsedJd> {
  const body = text.slice(0, 18000);
  try {
    const { object } = await generateObject({
      model: gateway(PARSE_MODEL),
      schema: jdSchema,
      prompt: dedent`
        Extract the hiring requirements from this job description document.
        Only include requirements the document actually states.

        POSITION: ${title}

        JOB DESCRIPTION:
        ${body}
      `,
    });
    return {
      ...object,
      companyName: object.companyName ?? undefined,
      minExperienceYears: object.minExperienceYears ?? undefined,
      education: object.education ?? undefined,
      location: object.location ?? undefined,
    };
  } catch {
    return {
      summary: body.slice(0, 400),
      skills: heuristicList(text, KNOWN_SOFT),
      technologies: heuristicList(text, KNOWN_TECH),
      certifications: [],
      minExperienceYears: heuristicYears(text) ?? undefined,
      responsibilities: [],
      softSkills: heuristicList(text, KNOWN_SOFT),
    };
  }
}

/* --------------------------------------------------------- match narrative */

export interface ExplainInput {
  jobTitle: string;
  jdSummary: string;
  candidateHeadline: string;
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  missingTech: string[];
  experienceYears: number | null;
  requiredExperience: number | null;
}

export async function explainMatch(input: ExplainInput) {
  try {
    const { object } = await generateObject({
      model: gateway(PARSE_MODEL),
      schema: explainSchema,
      prompt: dedent`
        You are a recruitment analyst. Explain this CV-to-JD match for a recruiter.
        Be concrete and blunt. Do not repeat the score.

        POSITION: ${input.jobTitle}
        JD SUMMARY: ${input.jdSummary}
        CANDIDATE: ${input.candidateHeadline}
        MATCH SCORE: ${input.score}/100
        EXPERIENCE: ${input.experienceYears ?? "unknown"} years (required: ${input.requiredExperience ?? "unspecified"})
        MATCHED SKILLS: ${input.matchedSkills.join(", ") || "none"}
        MISSING SKILLS: ${input.missingSkills.join(", ") || "none"}
        MISSING TECHNOLOGIES: ${input.missingTech.join(", ") || "none"}
      `,
    });
    return object;
  } catch {
    const verdict =
      input.score >= 80 ? "Strong alignment" : input.score >= 65 ? "Workable fit" : "Weak fit";
    return {
      explanation: `${verdict} for ${input.jobTitle}. Matches ${input.matchedSkills.length} required skills${
        input.missingSkills.length ? `, missing ${input.missingSkills.slice(0, 4).join(", ")}` : ""
      }.`,
      strengths: input.matchedSkills.slice(0, 5),
      recommendedFocusAreas: [...input.missingSkills, ...input.missingTech].slice(0, 5),
    };
  }
}

const skillClassSchema = z.object({
  items: z
    .array(
      z.object({
        skill: z.string(),
        class: z.enum(["core", "soft", "context"]),
      }),
    )
    .default([]),
});

/**
 * Classify skill strings the rule layers could not place. Only reached for
 * genuinely novel strings, and the caller caches every answer, so this runs once
 * per unique skill in the lifetime of the system.
 */
export async function classifySkillStrings(skills: string[]) {
  const { object } = await generateObject({
    model: gateway(PARSE_MODEL),
    schema: skillClassSchema,
    prompt: dedent`
      You are classifying strings that a CV/job-description parser extracted as
      "skills". Assign exactly one class to each, and return every input string
      verbatim.

      core    A technology, platform, protocol, tool, or a technical activity
              performed on one. Includes technical process work an IT service
              provider bills for: documentation, root-cause analysis, incident
              troubleshooting, ticket handling and escalation.
      soft    A behavioural, interpersonal or communication trait. Teamwork,
              written or spoken communication, customer service, time
              management, attention to detail, mentoring, adaptability.
      context Not a skill at all. Seniority or level statements, years of
              experience, employment logistics (shift times, time zones, remote
              working, visas), qualifications, or a restatement of the job title.

      When a string mentions a named technology, prefer core.
      When genuinely undecidable, answer core.

      STRINGS:
      ${skills.map((s, i) => `${i + 1}. ${s}`).join("\n")}
    `,
  });
  return object.items;
}

/** Free-form generation helper used by reports and the AI interview grader. */
export async function generatePlainText(prompt: string, model = REASON_MODEL): Promise<string> {
  const { text } = await generateText({ model: gateway(model), prompt });
  return text;
}
