import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Skillton schema — AI Recruitment Intelligence Platform.
 * Turso/SQLite via Drizzle. Embeddings are stored as JSON float arrays and
 * cosine similarity is computed in the matching service (replaces pgvector).
 */

import { DEFAULT_AI_VOICE } from "../lib/voices";

export * from "./auth-schema";

const now = () => new Date();
const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

/* ------------------------------------------------------------------ agencies */

export const agencies = sqliteTable("agencies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  subscriptionTier: text("subscription_tier").notNull().default("pro"),
  maxCvs: integer("max_cvs").notNull().default(100000),
  maxJds: integer("max_jds").notNull().default(5000),
  maxUsers: integer("max_users").notNull().default(50),
  /** JSON: { shortlistThreshold, scoreExpiryDays, matchWeight, techWeight, ... } */
  settings: text("settings", { mode: "json" }).$type<AgencySettings>(),
  createdAt: timestamp("created_at").notNull().$defaultFn(now),
});

export interface AgencySettings {
  shortlistThreshold: number;
  scoreExpiryDays: number;
  matchWeight: number;
  techWeight: number;
  aiInterviewEnabled: boolean;
  backupTime: string;
  backupAlertEmail: string;
  dailyRetentionDays: number;
  weeklyRetentionDays: number;
  /* ---- automated backup ---- */
  autoBackupEnabled: boolean;
  /** daily | weekly | monthly */
  backupFrequency: string;
  /** tigris | gdrive */
  backupProvider: string;
  backupRetainCopies: number;
  gdriveFolderId: string;
  gdriveClientId: string;
  /** Stored server-side only — never returned to the browser in full. */
  gdriveClientSecret: string;
  gdriveRefreshToken: string;
  /* ---- security ---- */
  /** Auto sign-out after this many idle minutes. 0 disables. */
  sessionIdleMinutes: number;
  /* ---- AI interview ---- */
  aiInterviewMinMinutes: number;
  aiInterviewMaxMinutes: number;
  /** Nudge the candidate after this many seconds of silence. */
  aiSilenceNudgeSeconds: number;
  aiSmallTalkEnabled: boolean;
  /** Realtime interviewer voice id — see api/lib/voices.ts for the catalogue. */
  aiVoice: string;
  /** Require camera + record the interview, and watch for fraud signals. */
  aiProctoringEnabled: boolean;
  /** Seconds deducted from the interview clock per second spent off-tab. */
  aiAwayPenaltyMultiplier: number;
  /* ---- money ---- */
  /** ISO-4217 code used when a record does not carry its own currency. */
  defaultCurrency: string;
  /* ---- buckets ---- */
  blueTagMinAiMatch: number;
  purpleTagMinTechScore: number;
  clientFailLimit: number;
}

export const DEFAULT_AGENCY_SETTINGS: AgencySettings = {
  shortlistThreshold: 65,
  scoreExpiryDays: 60,
  matchWeight: 0.2,
  techWeight: 0.8,
  aiInterviewEnabled: true,
  backupTime: "02:00",
  backupAlertEmail: "",
  dailyRetentionDays: 30,
  weeklyRetentionDays: 90,
  autoBackupEnabled: false,
  backupFrequency: "daily",
  backupProvider: "tigris",
  backupRetainCopies: 14,
  gdriveFolderId: "",
  gdriveClientId: "",
  gdriveClientSecret: "",
  gdriveRefreshToken: "",
  sessionIdleMinutes: 30,
  aiInterviewMinMinutes: 10,
  aiInterviewMaxMinutes: 15,
  aiSilenceNudgeSeconds: 10,
  aiSmallTalkEnabled: true,
  aiVoice: DEFAULT_AI_VOICE,
  aiProctoringEnabled: true,
  aiAwayPenaltyMultiplier: 2,
  defaultCurrency: "LKR",
  blueTagMinAiMatch: 60,
  purpleTagMinTechScore: 70,
  clientFailLimit: 3,
};

/* ------------------------------------------------------------------- clients */

export const clients = sqliteTable(
  "clients",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    companyName: text("company_name").notNull(),
    industry: text("industry"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    /** JSON: recruitment preferences */
    preferences: text("preferences", { mode: "json" }).$type<Record<string, string>>(),
    cultureNotes: text("culture_notes"),
    /* ---------------------------------------- sourcing & relationship depth */
    website: text("website"),
    companySize: text("company_size"),
    headquarters: text("headquarters"),
    locations: text("locations", { mode: "json" }).$type<string[]>(),
    accountManager: text("account_manager"),
    contactRole: text("contact_role"),
    /** direct | referral | inbound | linkedin | event | partner */
    sourceChannel: text("source_channel"),
    /** active | prospect | dormant | churned */
    relationshipStatus: text("relationship_status").notNull().default("active"),
    contractType: text("contract_type"),
    feeStructure: text("fee_structure"),
    paymentTerms: text("payment_terms"),
    slaDays: integer("sla_days"),
    workModel: text("work_model"),
    techStack: text("tech_stack", { mode: "json" }).$type<string[]>(),
    benefits: text("benefits", { mode: "json" }).$type<string[]>(),
    interviewProcess: text("interview_process"),
    dealBreakers: text("deal_breakers"),
    idealCandidateProfile: text("ideal_candidate_profile"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("clients_agency_idx").on(t.agencyId)],
);

/* ------------------------------------------------------- job descriptions */

export const jobDescriptions = sqliteTable(
  "job_descriptions",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    clientId: text("client_id"),
    title: text("title").notNull(),
    department: text("department"),
    location: text("location"),
    employmentType: text("employment_type").default("full_time"),
    experienceLevel: text("experience_level"),
    salaryRange: text("salary_range"),
    /** ISO-4217 code, e.g. LKR or USD. */
    salaryCurrency: text("salary_currency"),
    salaryMin: real("salary_min"),
    salaryMax: real("salary_max"),
    /** month | year — the period the salary figures refer to. */
    salaryPeriod: text("salary_period").default("month"),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    openings: integer("openings").notNull().default(1),
    /** JSON string[] — auto-extracted from the JD document */
    skillsRequired: text("skills_required", { mode: "json" }).$type<string[]>(),
    /** JSON — AI structured extraction of the JD document */
    parsed: text("parsed", { mode: "json" }).$type<ParsedJd>(),
    jdFilePath: text("jd_file_path"),
    jdFileName: text("jd_file_name"),
    jdText: text("jd_text"),
    /** JSON float[] embedding */
    jdVector: text("jd_vector", { mode: "json" }).$type<number[]>(),
    createdBy: text("created_by"),
    closedAt: timestamp("closed_at"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("jds_agency_idx").on(t.agencyId), index("jds_status_idx").on(t.status)],
);

export interface ParsedJd {
  summary?: string;
  skills?: string[];
  technologies?: string[];
  certifications?: string[];
  minExperienceYears?: number;
  education?: string;
  responsibilities?: string[];
  softSkills?: string[];
  location?: string;
}

/* ---------------------------------------------------------------- candidates */

export const candidates = sqliteTable(
  "candidates",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    email: text("email"),
    phone: text("phone"),
    location: text("location"),
    /** Human-facing candidate id, e.g. CID-00042. Unique per agency, searchable. */
    cid: text("cid"),
    /** National Identity Card number — searchable across the system. */
    nic: text("nic"),
    headline: text("headline"),
    /** website | linkedin | referral | job_portal | facebook | manual | university | database */
    source: text("source").notNull().default("manual"),
    currentStatus: text("current_status").notNull().default("new"),
    currentStage: text("current_stage").notNull().default("screening"),
    /** JSON string[] */
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    cvFilePath: text("cv_file_path"),
    cvFileName: text("cv_file_name"),
    cvText: text("cv_text"),
    cvVector: text("cv_vector", { mode: "json" }).$type<number[]>(),
    skillsExtracted: text("skills_extracted", { mode: "json" }).$type<string[]>(),
    technologies: text("technologies", { mode: "json" }).$type<string[]>(),
    experienceYears: real("experience_years"),
    education: text("education", { mode: "json" }).$type<string[]>(),
    certifications: text("certifications", { mode: "json" }).$type<string[]>(),
    languages: text("languages", { mode: "json" }).$type<string[]>(),
    projects: text("projects", { mode: "json" }).$type<string[]>(),
    parseStatus: text("parse_status").notNull().default("pending"),
    parseError: text("parse_error"),
    isDuplicateOf: text("is_duplicate_of"),
    /** JSON: which fields collided with the existing record (phone/nic/email). */
    duplicateFields: text("duplicate_fields", { mode: "json" }).$type<string[]>(),
    /** pending | accepted | rejected — recruiter's decision on a flagged duplicate. */
    duplicateDecision: text("duplicate_decision"),
    blacklistReason: text("blacklist_reason"),
    isBlacklisted: integer("is_blacklisted", { mode: "boolean" }).notNull().default(false),
    blacklistedAt: timestamp("blacklisted_at"),
    blacklistedBy: text("blacklisted_by"),
    /** green | yellow | red | blue | purple | null */
    bucket: text("bucket"),
    bucketReason: text("bucket_reason"),
    bucketSetAt: timestamp("bucket_set_at"),
    /** Number of failed client-side interviews; at the limit the candidate is removed. */
    clientFailCount: integer("client_fail_count").notNull().default(0),
    /** Selected at technical stage and awaiting a client-side decision. */
    isFlagged: integer("is_flagged", { mode: "boolean" }).notNull().default(false),
    /** placed | hold | rejected — outcome of the client-side interview */
    clientOutcome: text("client_outcome"),
    retentionPolicy: text("retention_policy").notNull().default("standard"),
    deletionScheduledAt: timestamp("deletion_scheduled_at"),
    anonymizedAt: timestamp("anonymized_at"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    index("candidates_agency_idx").on(t.agencyId),
    index("candidates_status_idx").on(t.currentStatus),
  ],
);

/* -------------------------------------------------------------- cv/jd match */

export const cvJdMatches = sqliteTable(
  "cv_jd_matches",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    jdId: text("jd_id").notNull(),
    matchScore: real("match_score").notNull(),
    baseScore: real("base_score"),
    skillsMatched: text("skills_matched", { mode: "json" }).$type<string[]>(),
    skillsMissing: text("skills_missing", { mode: "json" }).$type<string[]>(),
    technologiesMatched: text("technologies_matched", { mode: "json" }).$type<string[]>(),
    technologiesMissing: text("technologies_missing", { mode: "json" }).$type<string[]>(),
    certificationsMatched: text("certifications_matched", { mode: "json" }).$type<string[]>(),
    certificationsMissing: text("certifications_missing", { mode: "json" }).$type<string[]>(),
    strengths: text("strengths", { mode: "json" }).$type<string[]>(),
    aiExplanation: text("ai_explanation"),
    recommendedFocusAreas: text("recommended_focus_areas", { mode: "json" }).$type<string[]>(),
    isShortlisted: integer("is_shortlisted", { mode: "boolean" }).notNull().default(false),
    matchedAt: timestamp("matched_at").notNull().$defaultFn(now),
    /** 60-day score expiry: after this instant the score is hidden and excluded from matching. */
    expiresAt: timestamp("expires_at").notNull(),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("match_candidate_jd_idx").on(t.candidateId, t.jdId),
    index("match_jd_idx").on(t.jdId),
    index("match_expires_idx").on(t.expiresAt),
  ],
);

/* ------------------------------------------------------------ HR screening */

export const hrQuestions = sqliteTable(
  "hr_questions",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    label: text("label").notNull(),
    /** text | rating | boolean | select */
    fieldType: text("field_type").notNull().default("text"),
    options: text("options", { mode: "json" }).$type<string[]>(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("hrq_agency_idx").on(t.agencyId)],
);

export const interviewsHr = sqliteTable(
  "interviews_hr",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    jdId: text("jd_id"),
    recruiterId: text("recruiter_id"),
    communicationScore: integer("communication_score"),
    salaryExpectation: text("salary_expectation"),
    noticePeriod: text("notice_period"),
    willingToRelocate: integer("willing_to_relocate", { mode: "boolean" }),
    /** JSON: answers keyed by hr_question id */
    answers: text("answers", { mode: "json" }).$type<Record<string, string>>(),
    overallNotes: text("overall_notes"),
    result: text("result").notNull().default("hold"),
    conductedAt: timestamp("conducted_at").notNull().$defaultFn(now),
  },
  (t) => [index("hr_candidate_idx").on(t.candidateId)],
);

/* ------------------------------------------------------------ AI interview */

export const interviewsAi = sqliteTable(
  "interviews_ai",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    jdId: text("jd_id"),
    /** invite token used by the candidate interview room link */
    token: text("token").notNull().unique(),
    transcript: text("transcript", { mode: "json" }).$type<TranscriptTurn[]>(),
    audioUrl: text("audio_url"),
    videoUrl: text("video_url"),
    assessment: text("assessment", { mode: "json" }).$type<AiAssessment>(),
    aiSummary: text("ai_summary"),
    strengths: text("strengths", { mode: "json" }).$type<string[]>(),
    weaknesses: text("weaknesses", { mode: "json" }).$type<string[]>(),
    suggestedTechFocus: text("suggested_tech_focus", { mode: "json" }).$type<string[]>(),
    selectionReason: text("selection_reason"),
    topicCoverage: text("topic_coverage", { mode: "json" })
      .$type<{ topic: string; coverage: number; evidence?: string }[]>(),
    consentGiven: integer("consent_given", { mode: "boolean" }).notNull().default(false),
    identityVerified: integer("identity_verified", { mode: "boolean" }).notNull().default(false),
    /** Question set actually used, so the report can show what was asked. */
    questionSetId: text("question_set_id"),
    /* ---- proctoring ---- */
    /** Times the candidate left the interview tab or the window lost focus. */
    focusLossCount: integer("focus_loss_count").notNull().default(0),
    /** Total seconds spent away from the interview tab. */
    awaySeconds: integer("away_seconds").notNull().default(0),
    /** Seconds added back to the clock to compensate for time away. */
    timePenaltySeconds: integer("time_penalty_seconds").notNull().default(0),
    /** JSON: distinct fraud signals raised, e.g. ["looking_away","headphones"]. */
    fraudFlags: text("fraud_flags", { mode: "json" }).$type<string[]>(),
    /** JSON: the full proctoring event log kept as interview evidence. */
    proctorEvents: text("proctor_events", { mode: "json" }).$type<ProctorEvent[]>(),
    /**
     * JSON: snapshots of earlier attempts at this interview. Re-scheduling wipes
     * the live columns, so the previous report and its evidence are archived here
     * instead of being lost.
     */
    previousAttempts: text("previous_attempts", { mode: "json" }).$type<AiInterviewAttempt[]>(),
    /** Slot the recruiter booked, quoted to the candidate in the invitation. */
    scheduledAt: timestamp("scheduled_at"),
    /** When the invitation email should leave. Null means it went immediately. */
    inviteSendAt: timestamp("invite_send_at"),
    inviteSentAt: timestamp("invite_sent_at"),
    /** Address a queued invitation must be sent to. */
    inviteEmail: text("invite_email"),
    /** A queued mail that is a re-schedule notice rather than a first invite. */
    inviteIsReschedule: integer("invite_is_reschedule", { mode: "boolean" }).notNull().default(false),
    /** Times the candidate rejoined the room after a reload or a dropped tab. */
    resumeCount: integer("resume_count").notNull().default(0),
    /** Last moment the room reported activity — used to price a reload gap. */
    lastSeenAt: timestamp("last_seen_at"),
    /** Positive behavioural signals, e.g. ["strong_eye_contact"]. */
    positiveSignals: text("positive_signals", { mode: "json" }).$type<string[]>(),
    status: text("status").notNull().default("pending"),
    durationSeconds: integer("duration_seconds"),
    invitedAt: timestamp("invited_at").notNull().$defaultFn(now),
    conductedAt: timestamp("conducted_at"),
    expiresAt: timestamp("expires_at"),
  },
  (t) => [index("ai_candidate_idx").on(t.candidateId)],
);

export interface TranscriptTurn {
  role: "ai" | "candidate";
  text: string;
  at: number;
}

/** An archived earlier sitting of the same AI interview. */
export interface AiInterviewAttempt {
  at: number;
  status: string;
  conductedAt: number | null;
  durationSeconds: number | null;
  aiSummary: string | null;
  assessment: AiAssessment | null;
  transcript: TranscriptTurn[];
  videoUrl: string | null;
  audioUrl: string | null;
  fraudFlags: string[];
  focusLossCount: number;
  awaySeconds: number;
  rescheduledBy?: string | null;
  reason?: string | null;
}

export interface ProctorEvent {
  /** tab_hidden | tab_visible | window_blur | looking_away | reading | headphones | no_face | multiple_faces */
  kind: string;
  at: number;
  detail?: string | null;
  /** Seconds the condition lasted, when it is a duration rather than an instant. */
  seconds?: number;
  /** Integrity flags raised by the camera check for this event. */
  flags?: string[];
}

export interface AiAssessment {
  communication: number;
  confidence: number;
  knowledge: number;
  professionalism: number;
  criticalThinking: number;
  responseConsistency: number;
  /**
   * Per-dimension justification: the candidate's own words behind each score.
   * Optional because rows graded before this existed have none, and because
   * `assessment` is a JSON column the extra key needed no migration.
   */
  notes?: {
    communication?: string;
    confidence?: string;
    knowledge?: string;
    professionalism?: string;
    criticalThinking?: string;
    responseConsistency?: string;
  };
}

/* ------------------------------------------------------- technical interview */

export const techTemplates = sqliteTable(
  "tech_templates",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    name: text("name").notNull(),
    ratingScaleMax: integer("rating_scale_max").notNull().default(10),
    /** JSON: [{ name, weight, parameters: string[] }] */
    sections: text("sections", { mode: "json" }).$type<TechSection[]>(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("tt_agency_idx").on(t.agencyId)],
);

export interface TechSection {
  name: string;
  weight: number;
  parameters: string[];
}

export const interviewsTechnical = sqliteTable(
  "interviews_technical",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    jdId: text("jd_id"),
    interviewerId: text("interviewer_id"),
    templateId: text("template_id"),
    totalScore: real("total_score").notNull().default(0),
    /** JSON: { [section]: { [parameter]: number } } */
    sectionScores: text("section_scores", { mode: "json" }).$type<Record<string, Record<string, number>>>(),
    comments: text("comments"),
    /** Raw weighted score before the comment-sentiment adjustment. */
    rawScore: real("raw_score"),
    /** Points added (positive comment) or removed (negative comment). */
    sentimentAdjustment: real("sentiment_adjustment").notNull().default(0),
    /** positive | negative | neutral */
    commentSentiment: text("comment_sentiment"),
    sentimentRationale: text("sentiment_rationale"),
    selectionReason: text("selection_reason"),
    recommendation: text("recommendation").notNull().default("hold"),
    conductedAt: timestamp("conducted_at").notNull().$defaultFn(now),
    /** Set when a completed evaluation is amended, so the change is auditable. */
    editedAt: timestamp("edited_at"),
    editedBy: text("edited_by"),
  },
  (t) => [index("tech_candidate_idx").on(t.candidateId)],
);

/* ------------------------------------------------------------- placements */

export const placements = sqliteTable(
  "placements",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    jdId: text("jd_id"),
    clientId: text("client_id"),
    /** denormalized so the Placed page survives retention cleanup */
    candidateName: text("candidate_name").notNull(),
    candidateEmail: text("candidate_email"),
    positionTitle: text("position_title").notNull(),
    clientName: text("client_name"),
    department: text("department"),
    location: text("location"),
    offeredSalary: text("offered_salary"),
    /** ISO-4217 code for offeredSalaryAmount. */
    salaryCurrency: text("salary_currency"),
    offeredSalaryAmount: real("offered_salary_amount"),
    startDate: timestamp("start_date"),
    placedAt: timestamp("placed_at").notNull().$defaultFn(now),
    matchScoreAtHire: real("match_score_at_hire"),
    techScoreAtHire: real("tech_score_at_hire"),
    finalScore: real("final_score"),
    timeToHireDays: integer("time_to_hire_days"),
    recruiterId: text("recruiter_id"),
    recruiterName: text("recruiter_name"),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
  },
  (t) => [index("placements_agency_idx").on(t.agencyId)],
);

/* ------------------------------------------------------------ ops & config */

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id"),
    userId: text("user_id"),
    userName: text("user_name"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    oldValues: text("old_values", { mode: "json" }),
    newValues: text("new_values", { mode: "json" }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

export const backupLogs = sqliteTable("backup_logs", {
  id: text("id").primaryKey(),
  backupType: text("backup_type").notNull(),
  fileName: text("file_name").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull().default(0),
  destination: text("destination").notNull().default("tigris"),
  storageKey: text("storage_key"),
  checksum: text("checksum"),
  status: text("status").notNull().default("in_progress"),
  errorMessage: text("error_message"),
  dbSnapshot: integer("db_snapshot", { mode: "boolean" }).notNull().default(true),
  cvsIncluded: integer("cvs_included", { mode: "boolean" }).notNull().default(false),
  jdsIncluded: integer("jds_included", { mode: "boolean" }).notNull().default(false),
  recordCount: integer("record_count").notNull().default(0),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  triggeredBy: text("triggered_by"),
  createdAt: timestamp("created_at").notNull().$defaultFn(now),
});

export const cleanupLogs = sqliteTable("cleanup_logs", {
  id: text("id").primaryKey(),
  rule: text("rule").notNull(),
  affectedCount: integer("affected_count").notNull().default(0),
  details: text("details"),
  runAt: timestamp("run_at").notNull().$defaultFn(now),
});

export const blacklistReasons = sqliteTable("blacklist_reasons", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").notNull(),
  label: text("label").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    userId: text("user_id"),
    title: text("title").notNull(),
    body: text("body"),
    kind: text("kind").notNull().default("info"),
    link: text("link"),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("notif_agency_idx").on(t.agencyId)],
);

export const candidateEvents = sqliteTable(
  "candidate_events",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id").notNull(),
    agencyId: text("agency_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    actorName: text("actor_name"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("events_candidate_idx").on(t.candidateId)],
);

/* ------------------------------------------- AI interview question banks */

/**
 * Per-job-title question sets. The voice agent may only ask from the matching
 * set (plus its follow-ups) — nothing off-topic.
 */
export const aiQuestionSets = sqliteTable(
  "ai_question_sets",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    /** Job title this set applies to, matched case-insensitively. */
    jobTitle: text("job_title").notNull(),
    /** Optional: bind the set to one specific JD instead of a title. */
    jdId: text("jd_id"),
    description: text("description"),
    questions: text("questions", { mode: "json" }).$type<AiQuestion[]>(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(now),
  },
  (t) => [index("aiqs_agency_idx").on(t.agencyId)],
);

export interface AiQuestion {
  question: string;
  followUps: string[];
}

/* ------------------------------------------------- client-side interviews */

/** Outcome of the client's own interview round, after technical selection. */
export const clientInterviews = sqliteTable(
  "client_interviews",
  {
    id: text("id").primaryKey(),
    agencyId: text("agency_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    jdId: text("jd_id"),
    clientId: text("client_id"),
    /** placed | hold | rejected */
    outcome: text("outcome").notNull().default("hold"),
    feedback: text("feedback"),
    recordedBy: text("recorded_by"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("clientint_candidate_idx").on(t.candidateId)],
);

/* ------------------------------------------------------- backup schedule */

export const backupSchedules = sqliteTable("backup_schedules", {
  agencyId: text("agency_id").primaryKey(),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
});

/* --------------------------------------------------------- skill taxonomy */

/**
 * Cache of the skill taxonomy decision for one normalised skill string, so a
 * string the model had to classify is only ever classified once. `source` is
 * `llm` for a model answer and `manual` for a human override, which always wins.
 */
export const skillClasses = sqliteTable("skill_classes", {
  skillKey: text("skill_key").primaryKey(),
  label: text("label").notNull(),
  /** core | soft | context */
  skillClass: text("skill_class").notNull().default("core"),
  /** llm | manual */
  source: text("source").notNull().default("llm"),
  createdAt: timestamp("created_at").notNull().$defaultFn(now),
  updatedAt: timestamp("updated_at").notNull().$defaultFn(now),
});

export const sqlNow = sql;
