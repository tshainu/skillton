import { db } from "../database";
import * as schema from "../database/schema";
import { newId } from "./ids";

/**
 * Extra HR screening questions. Communication clarity, expected salary, notice
 * period and willingness to relocate are first-class columns on the screening
 * form, so they must never be duplicated here.
 */
const HR_QUESTIONS: { label: string; fieldType: string; options?: string[] }[] = [
  { label: "General behaviour & professionalism", fieldType: "rating" },
  { label: "Motivation for this role", fieldType: "rating" },
  { label: "Comfortable with company policies", fieldType: "boolean" },
  { label: "Preferred working hours", fieldType: "select", options: ["Standard", "Flexible", "Shift", "Night"] },
  { label: "Reason for leaving current role", fieldType: "text" },
];

const BLACKLIST_REASONS = [
  "Fake Resume",
  "Fake Experience",
  "Failed Identity Verification",
  "Poor Professional Conduct",
  "Duplicate Candidate",
  "Client Request",
];

const DEFAULT_TECH_SECTIONS = [
  {
    name: "Core Technical Knowledge",
    weight: 35,
    parameters: ["Fundamentals", "Language proficiency", "Framework depth"],
  },
  {
    name: "Problem Solving",
    weight: 25,
    parameters: ["Approach & reasoning", "Edge case handling", "Efficiency"],
  },
  {
    name: "System & Architecture",
    weight: 20,
    parameters: ["Design thinking", "Scalability awareness", "Data modelling"],
  },
  {
    name: "Practical Experience",
    weight: 15,
    parameters: ["Project depth", "Tooling & delivery", "Testing discipline"],
  },
  {
    name: "Communication",
    weight: 5,
    parameters: ["Explains clearly", "Collaboration signals"],
  },
];

/** Seed the per-agency configuration a new workspace needs to be usable. */
export async function seedAgencyDefaults(agencyId: string) {
  await db.insert(schema.hrQuestions).values(
    HR_QUESTIONS.map((q, i) => ({
      id: newId("hrq"),
      agencyId,
      label: q.label,
      fieldType: q.fieldType,
      options: q.options ?? null,
      sortOrder: i,
    })),
  );

  await db.insert(schema.blacklistReasons).values(
    BLACKLIST_REASONS.map((label) => ({ id: newId("blr"), agencyId, label })),
  );

  await db.insert(schema.techTemplates).values({
    id: newId("tpl"),
    agencyId,
    name: "Standard Engineering Evaluation",
    ratingScaleMax: 10,
    sections: DEFAULT_TECH_SECTIONS,
    isDefault: true,
  });
}
