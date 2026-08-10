import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import * as schema from "../database/schema";
import { fallbackEmbedding } from "../lib/embeddings";
import { newId, newToken } from "../lib/ids";
import { computeMatchScore, DAY_MS, finalScore, overlap } from "../lib/scoring";
import { adminOnly, audit, authed, getSettings, timeline } from "../middleware/auth";

/**
 * Demo data seeder — fills a fresh workspace with a realistic pipeline so every
 * screen has something to show, including one deliberately EXPIRED match score
 * to demonstrate the expiry behaviour.
 */

const CLIENTS = [
  {
    companyName: "Northwind Fintech",
    industry: "Financial Services",
    contactName: "Priya Raman",
    contactEmail: "priya@northwind.io",
    cultureNotes: "Fast-moving, remote-first, values ownership over process.",
    website: "https://northwind.io",
    companySize: "250–500",
    headquarters: "Singapore",
    locations: ["Singapore", "Colombo", "Remote (APAC)"],
    accountManager: "Priyanka de Silva",
    contactRole: "VP Engineering",
    sourceChannel: "referral",
    relationshipStatus: "active",
    contractType: "Contingency",
    feeStructure: "18% of first-year CTC",
    paymentTerms: "Net 30",
    slaDays: 14,
    workModel: "remote",
    techStack: ["Node.js", "TypeScript", "PostgreSQL", "AWS", "Kafka"],
    benefits: ["Full remote", "Annual learning budget", "Private medical"],
    interviewProcess: "HR screen → technical (2 rounds) → system design → founder chat",
    dealBreakers: "No candidates who require visa sponsorship in the first year.",
    idealCandidateProfile: "Product-minded backend engineers from high-throughput payments or trading systems.",
    notes: "Decisions are fast — expect feedback within 48 hours of each round.",
  },
  {
    companyName: "Helix Health",
    industry: "Healthcare Technology",
    contactName: "Daniel Okoye",
    contactEmail: "daniel@helixhealth.com",
    cultureNotes: "Regulated environment. Documentation and compliance discipline matter.",
    website: "https://helixhealth.com",
    companySize: "1000+",
    headquarters: "London, United Kingdom",
    locations: ["London", "Dublin", "Colombo"],
    accountManager: "Nuwan Alwis",
    contactRole: "Head of Data",
    sourceChannel: "inbound",
    relationshipStatus: "active",
    contractType: "Retained",
    feeStructure: "20% retained, 3 instalments",
    paymentTerms: "Net 45",
    slaDays: 21,
    workModel: "hybrid",
    techStack: ["Python", "dbt", "Snowflake", "Airflow", "Azure"],
    benefits: ["Hybrid 2 days onsite", "Pension match", "Wellbeing allowance"],
    interviewProcess: "HR screen → data modelling exercise → panel → compliance briefing",
    dealBreakers: "Any prior data-protection breach or unexplained employment gap over 12 months.",
    idealCandidateProfile: "Analytics engineers comfortable in regulated, audited data environments.",
    notes: "All offers require a background and right-to-work check before release.",
  },
  {
    companyName: "Corevault Cloud",
    industry: "Cloud Infrastructure",
    contactName: "Mei Tan",
    contactEmail: "mei@corevault.dev",
    cultureNotes: "Deep engineering culture, high bar on systems fundamentals.",
    website: "https://corevault.dev",
    companySize: "50–250",
    headquarters: "Colombo, Sri Lanka",
    locations: ["Colombo", "Kandy"],
    accountManager: "Priyanka de Silva",
    contactRole: "CTO",
    sourceChannel: "event",
    relationshipStatus: "active",
    contractType: "Contingency",
    feeStructure: "16% of first-year CTC",
    paymentTerms: "Net 30",
    slaDays: 10,
    workModel: "onsite",
    techStack: ["Kubernetes", "Terraform", "Go", "AWS", "Prometheus"],
    benefits: ["Stock options", "On-call allowance", "Conference budget"],
    interviewProcess: "HR screen → Linux/networking deep dive → live incident exercise → CTO round",
    dealBreakers: "Candidates unwilling to join the on-call rotation.",
    idealCandidateProfile: "SREs with real multi-region production ownership, not just certification.",
    notes: "Strongest client for senior platform roles — repeat business every quarter.",
  },
];

interface JobSeed {
  title: string;
  department: string;
  location: string;
  experienceLevel: string;
  salaryRange: string;
  priority: string;
  openings: number;
  skills: string[];
  minExperienceYears: number;
  education: string;
  summary: string;
}

const JOBS: JobSeed[] = [
  {
    title: "Senior Backend Engineer",
    department: "Engineering",
    location: "Colombo, Sri Lanka",
    experienceLevel: "senior",
    salaryRange: "LKR 550,000 – 750,000 / month",
    priority: "high",
    openings: 2,
    skills: ["Node.js", "TypeScript", "PostgreSQL", "AWS", "Kubernetes", "System Design", "REST APIs", "Redis"],
    minExperienceYears: 5,
    education: "Bachelor in Computer Science",
    summary: "Own the core payments services: high-throughput APIs, event pipelines and data consistency across services.",
  },
  {
    title: "Data Engineer",
    department: "Data",
    location: "Remote",
    experienceLevel: "mid",
    salaryRange: "USD 45,000 – 62,000 / year",
    priority: "medium",
    openings: 1,
    skills: ["Python", "SQL", "Airflow", "dbt", "Snowflake", "Spark", "Data Modelling"],
    minExperienceYears: 3,
    education: "Bachelor in Engineering",
    summary: "Build and own the clinical analytics warehouse, from ingestion through modelled marts.",
  },
  {
    title: "Site Reliability Engineer",
    department: "Platform",
    location: "Colombo, Sri Lanka",
    experienceLevel: "senior",
    salaryRange: "LKR 600,000 – 820,000 / month",
    priority: "urgent",
    openings: 1,
    skills: ["Kubernetes", "Terraform", "AWS", "Observability", "Go", "Linux", "CI/CD", "Incident Response"],
    minExperienceYears: 6,
    education: "Bachelor in Computer Science",
    summary: "Keep a multi-region control plane at four nines. Own reliability, automation and on-call quality.",
  },
  {
    title: "Frontend Engineer (React)",
    department: "Product",
    location: "Kandy, Sri Lanka",
    experienceLevel: "mid",
    salaryRange: "LKR 380,000 – 520,000 / month",
    priority: "medium",
    openings: 2,
    skills: ["React", "TypeScript", "CSS", "Accessibility", "Testing", "Design Systems"],
    minExperienceYears: 3,
    education: "Bachelor in Software Engineering",
    summary: "Build the customer-facing dashboard: a design system, complex data views and a very high polish bar.",
  },
];

interface CandidateSeed {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  experienceYears: number;
  skills: string[];
  technologies: string[];
  education: string[];
  certifications: string[];
  jobIndex: number;
  status: string;
  stage: string;
  tags: string[];
  nic: string;
  source: string;
  bucket?: string;
  bucketReason?: string;
  isFlagged?: boolean;
  clientOutcome?: string;
  clientFailCount?: number;
  isBlacklisted?: boolean;
  blacklistReason?: string;
}

const CANDIDATES: CandidateSeed[] = [
  { nic: "199012304567V", source: "referral", isFlagged: true, firstName: "Arun", lastName: "Fernando", email: "arun.fernando@example.com", phone: "+94 77 412 8890", location: "Colombo, Sri Lanka", headline: "Senior Backend Engineer · 8 yrs · payments & event-driven systems", experienceYears: 8, skills: ["Node.js", "TypeScript", "PostgreSQL", "AWS", "Kubernetes", "System Design", "REST APIs", "Redis", "Kafka"], technologies: ["Node.js", "NestJS", "PostgreSQL", "Redis", "Kafka", "Docker", "Kubernetes", "AWS"], education: ["BSc Computer Science, University of Colombo"], certifications: ["AWS Certified Solutions Architect – Associate"], jobIndex: 0, status: "tech_interview_pending", stage: "technical", tags: ["top-tier", "immediate joiner"] },
  { nic: "199234508811V", source: "linkedin", bucket: "green", bucketReason: "Cleared HR screening — strong communicator", firstName: "Nadia", lastName: "Perera", email: "nadia.perera@example.com", phone: "+94 71 220 4413", location: "Colombo, Sri Lanka", headline: "Backend Engineer · 6 yrs · fintech APIs", experienceYears: 6, skills: ["Node.js", "TypeScript", "PostgreSQL", "AWS", "REST APIs", "Redis", "GraphQL"], technologies: ["Express", "PostgreSQL", "Redis", "AWS Lambda", "Terraform"], education: ["BEng Software Engineering, SLIIT"], certifications: [], jobIndex: 0, status: "ai_interview_completed", stage: "ai_interview", tags: ["strong communicator"] },
  { nic: "199645712233V", source: "job_portal", firstName: "Kasun", lastName: "Silva", email: "kasun.silva@example.com", phone: "+94 76 883 1122", location: "Galle, Sri Lanka", headline: "Full-stack Engineer · 4 yrs · Node + React", experienceYears: 4, skills: ["Node.js", "TypeScript", "React", "MySQL", "REST APIs"], technologies: ["Node.js", "React", "MySQL", "Docker"], education: ["BSc Information Technology, University of Moratuwa"], certifications: [], jobIndex: 0, status: "ai_interview_pending", stage: "ai_interview", tags: [] },
  { nic: "199156609988V", source: "website", isFlagged: true, firstName: "Ishara", lastName: "Wijesinghe", email: "ishara.w@example.com", phone: "+94 70 551 7788", location: "Colombo, Sri Lanka", headline: "Data Engineer · 5 yrs · warehouse & pipelines", experienceYears: 5, skills: ["Python", "SQL", "Airflow", "dbt", "Snowflake", "Data Modelling", "Spark"], technologies: ["Python", "Airflow", "dbt", "Snowflake", "BigQuery"], education: ["MSc Data Science, University of Colombo", "BSc Statistics"], certifications: ["dbt Analytics Engineering Certification"], jobIndex: 1, status: "tech_interview_pending", stage: "technical", tags: ["remote-ready"] },
  { nic: "199788201144X", source: "database", firstName: "Ravi", lastName: "Kumar", email: "ravi.kumar@example.com", phone: "+91 98 4412 6677", location: "Bengaluru, India", headline: "Analytics Engineer · 3 yrs · dbt + Snowflake", experienceYears: 3, skills: ["SQL", "Python", "dbt", "Snowflake", "Data Modelling"], technologies: ["dbt", "Snowflake", "Looker", "Python"], education: ["BTech Computer Science, VIT"], certifications: [], jobIndex: 1, status: "ai_interview_pending", stage: "ai_interview", tags: [] },
  { nic: "198934507766V", source: "referral", bucket: "green", bucketReason: "Placed at Corevault Cloud", firstName: "Dilani", lastName: "Jayawardena", email: "dilani.j@example.com", phone: "+94 77 990 2211", location: "Colombo, Sri Lanka", headline: "SRE · 7 yrs · multi-region Kubernetes", experienceYears: 7, skills: ["Kubernetes", "Terraform", "AWS", "Observability", "Go", "Linux", "CI/CD", "Incident Response"], technologies: ["Kubernetes", "Terraform", "Prometheus", "Grafana", "Go", "ArgoCD"], education: ["BSc Computer Engineering, University of Peradeniya"], certifications: ["Certified Kubernetes Administrator", "AWS DevOps Professional"], jobIndex: 2, status: "hired", stage: "hired", tags: ["placed"] },
  { nic: "199322104455V", source: "facebook", firstName: "Tharindu", lastName: "Bandara", email: "tharindu.b@example.com", phone: "+94 75 331 6644", location: "Colombo, Sri Lanka", headline: "DevOps Engineer · 5 yrs · AWS & CI/CD", experienceYears: 5, skills: ["Kubernetes", "AWS", "CI/CD", "Linux", "Terraform"], technologies: ["Jenkins", "Kubernetes", "AWS", "Ansible"], education: ["BSc Information Systems, NSBM"], certifications: ["Certified Kubernetes Administrator"], jobIndex: 2, status: "ai_interview_pending", stage: "ai_interview", tags: [] },
  { nic: "199501603322V", source: "university", bucket: "blue", bucketReason: "AI interview passed at 71% match, technical 58/100", firstName: "Hasini", lastName: "Gunawardena", email: "hasini.g@example.com", phone: "+94 71 774 8899", location: "Kandy, Sri Lanka", headline: "Frontend Engineer · 4 yrs · React design systems", experienceYears: 4, skills: ["React", "TypeScript", "CSS", "Accessibility", "Testing", "Design Systems"], technologies: ["React", "Vite", "Tailwind", "Playwright", "Storybook"], education: ["BSc Software Engineering, University of Kelaniya"], certifications: [], jobIndex: 3, status: "ai_interview_completed", stage: "ai_interview", tags: ["portfolio strong"] },
  { nic: "199811709900V", source: "manual", bucket: "yellow", bucketReason: "Insufficient experience for the current role", firstName: "Sanjay", lastName: "Mendis", email: "sanjay.mendis@example.com", phone: "+94 76 118 3344", location: "Colombo, Sri Lanka", headline: "Frontend Developer · 2 yrs · React + Next", experienceYears: 2, skills: ["React", "JavaScript", "CSS", "Testing"], technologies: ["React", "Next.js", "Jest"], education: ["Diploma in Web Development, IJSE"], certifications: [], jobIndex: 3, status: "ai_interview_pending", stage: "ai_interview", tags: [] },
  { nic: "199077805511V", source: "linkedin", bucket: "purple", bucketReason: "Technical 82/100, rejected at client interview", clientOutcome: "rejected", clientFailCount: 1, firstName: "Amaya", lastName: "Rajapaksa", email: "amaya.r@example.com", phone: "+94 77 665 1010", location: "Kandy, Sri Lanka", headline: "Senior Frontend Engineer · 6 yrs · accessibility specialist", experienceYears: 6, skills: ["React", "TypeScript", "CSS", "Accessibility", "Design Systems", "Testing", "Performance"], technologies: ["React", "TypeScript", "Tailwind", "Cypress", "Figma"], education: ["BSc Computer Science, University of Colombo"], certifications: [], jobIndex: 3, status: "ai_interview_pending", stage: "ai_interview", tags: ["a11y expert"] },
  { nic: "199466301199V", source: "job_portal", isBlacklisted: true, blacklistReason: "Fake Experience", firstName: "Chamara", lastName: "Weerasinghe", email: "chamara.w@example.com", phone: "+94 72 445 9012", location: "Negombo, Sri Lanka", headline: "Backend Engineer · claimed 9 yrs · Node + Java", experienceYears: 9, skills: ["Node.js", "Java", "Spring", "MySQL", "REST APIs"], technologies: ["Node.js", "Spring Boot", "MySQL"], education: ["BSc Computer Science"], certifications: [], jobIndex: 0, status: "rejected", stage: "sourced", tags: ["verification failed"] },
];

function cvText(c: CandidateSeed) {
  return [
    `${c.firstName} ${c.lastName} — ${c.headline}`,
    `Location: ${c.location} | Email: ${c.email} | Phone: ${c.phone}`,
    `Experience: ${c.experienceYears} years`,
    `Skills: ${c.skills.join(", ")}`,
    `Technologies: ${c.technologies.join(", ")}`,
    `Education: ${c.education.join("; ")}`,
    c.certifications.length ? `Certifications: ${c.certifications.join(", ")}` : "",
    `Summary: ${c.experienceYears}+ years building and shipping production systems with ${c.technologies.slice(0, 3).join(", ")}. Comfortable owning delivery end to end, mentoring engineers and working directly with stakeholders.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function jdText(j: JobSeed) {
  return [
    `${j.title} — ${j.department}`,
    `Location: ${j.location} | Level: ${j.experienceLevel} | Openings: ${j.openings}`,
    `Compensation: ${j.salaryRange}`,
    `About the role: ${j.summary}`,
    `Required skills: ${j.skills.join(", ")}`,
    `Minimum experience: ${j.minExperienceYears} years`,
    `Education: ${j.education}`,
  ].join("\n");
}

const AI_SUMMARIES: Record<string, { summary: string; strengths: string[]; weaknesses: string[]; focus: string[] }> = {
  Nadia: {
    summary:
      "Clear, structured communicator. Walked through a payment reconciliation failure with concrete metrics and owned the postmortem. Explained trade-offs without hedging. Motivation is a step up in system ownership.",
    strengths: ["Structured, metric-backed answers", "Genuine ownership of production incidents", "Strong stakeholder communication"],
    weaknesses: ["Limited exposure to container orchestration at scale", "Vague on cost trade-offs in infra decisions"],
    focus: ["Kubernetes operations", "Distributed transactions", "Caching strategy under load"],
  },
  Hasini: {
    summary:
      "Highly articulate about design-system work and accessibility trade-offs. Gave a specific example of cutting a bundle by 40% and could explain the measurement method. Slight nervousness early, settled quickly.",
    strengths: ["Deep accessibility reasoning", "Measurable performance work", "Strong product empathy"],
    weaknesses: ["Thin on state-management at large scale", "Little backend context"],
    focus: ["Complex state architecture", "Rendering performance profiling", "Component API design"],
  },
};

export const demo = {
  /** Whether this workspace already has demo/live data. */
  status: authed.handler(async ({ context }) => {
    const [c] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.candidates)
      .where(eq(schema.candidates.agencyId, context.agencyId));
    const [j] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.jobDescriptions)
      .where(eq(schema.jobDescriptions.agencyId, context.agencyId));
    return { candidates: Number(c?.n ?? 0), jobs: Number(j?.n ?? 0) };
  }),

  /** Seed a complete demo pipeline. Idempotent-ish: refuses if data already exists unless `force`. */
  seed: adminOnly
    .input(z.object({ force: z.boolean().default(false) }).default({ force: false }))
    .handler(async ({ input, context }) => {
      const agencyId = context.agencyId;
      const settings = await getSettings(agencyId);

      const [existing] = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.candidates)
        .where(eq(schema.candidates.agencyId, agencyId));
      if (Number(existing?.n ?? 0) > 0 && !input.force) {
        return { seeded: false, reason: "Workspace already has candidates" };
      }

      /**
       * `force` replaces the demo set rather than stacking a second copy on top
       * of it — without this, repeated seeds duplicate every candidate, match
       * and interview.
       */
      if (input.force) {
        for (const table of [
          schema.aiQuestionSets,
          schema.clientInterviews,
          schema.interviewsAi,
          schema.interviewsHr,
          schema.interviewsTechnical,
          schema.cvJdMatches,
          schema.candidateEvents,
          schema.placements,
          schema.candidates,
          schema.jobDescriptions,
          schema.clients,
        ]) {
          await db.delete(table).where(eq(table.agencyId, agencyId));
        }
      }

      /* ------------------------------------------------------------ clients */
      const clientIds: string[] = [];
      for (const c of CLIENTS) {
        const id = newId("cli");
        clientIds.push(id);
        await db.insert(schema.clients).values({
          id,
          agencyId,
          companyName: c.companyName,
          industry: c.industry,
          contactName: c.contactName,
          contactEmail: c.contactEmail,
          contactPhone: "+94 11 234 5678",
          cultureNotes: c.cultureNotes,
          preferences: { hiringSpeed: "fast", interviewRounds: "3" },
          website: c.website,
          companySize: c.companySize,
          headquarters: c.headquarters,
          locations: c.locations,
          accountManager: c.accountManager,
          contactRole: c.contactRole,
          sourceChannel: c.sourceChannel,
          relationshipStatus: c.relationshipStatus,
          contractType: c.contractType,
          feeStructure: c.feeStructure,
          paymentTerms: c.paymentTerms,
          slaDays: c.slaDays,
          workModel: c.workModel,
          techStack: c.techStack,
          benefits: c.benefits,
          interviewProcess: c.interviewProcess,
          dealBreakers: c.dealBreakers,
          idealCandidateProfile: c.idealCandidateProfile,
          notes: c.notes,
        });
      }

      /* --------------------------------------------------------------- jobs */
      const jobIds: string[] = [];
      for (let i = 0; i < JOBS.length; i++) {
        const j = JOBS[i]!;
        const id = newId("jd");
        jobIds.push(id);
        const text = jdText(j);
        await db.insert(schema.jobDescriptions).values({
          id,
          agencyId,
          clientId: clientIds[i % clientIds.length]!,
          title: j.title,
          department: j.department,
          location: j.location,
          employmentType: "full_time",
          experienceLevel: j.experienceLevel,
          salaryRange: j.salaryRange,
          priority: j.priority,
          status: "open",
          openings: j.openings,
          skillsRequired: j.skills,
          parsed: {
            summary: j.summary,
            skills: j.skills,
            technologies: j.skills,
            minExperienceYears: j.minExperienceYears,
            education: j.education,
            location: j.location,
            responsibilities: [
              `Own delivery of ${j.title.toLowerCase()} work end to end`,
              "Partner with product and design on scope and trade-offs",
              "Raise the engineering bar through review and mentoring",
            ],
            softSkills: ["Ownership", "Clear written communication", "Pragmatism"],
          },
          jdText: text,
          jdVector: fallbackEmbedding(text),
          jdFileName: `${j.title.toLowerCase().replace(/\s+/g, "-")}.pdf`,
          createdBy: context.user.id,
        });
      }

      /* --------------------------------------------------------- candidates */
      const candidateIds: string[] = [];
      const now = Date.now();

      for (let i = 0; i < CANDIDATES.length; i++) {
        const c = CANDIDATES[i]!;
        const id = newId("can");
        candidateIds.push(id);
        const text = cvText(c);
        const cvFileName = `${c.firstName.toLowerCase()}-${c.lastName.toLowerCase()}-cv.pdf`;
        const createdAt = new Date(now - (i + 1) * 3 * DAY_MS);
        await db.insert(schema.candidates).values({
          id,
          agencyId,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          phone: c.phone,
          location: c.location,
          headline: c.headline,
          currentStatus: c.status,
          currentStage: c.stage,
          tags: c.tags,
          nic: c.nic,
          source: c.source,
          bucket: c.bucket ?? null,
          bucketReason: c.bucketReason ?? null,
          bucketSetAt: c.bucket ? createdAt : null,
          isFlagged: c.isFlagged ?? false,
          clientOutcome: c.clientOutcome ?? null,
          clientFailCount: c.clientFailCount ?? 0,
          isBlacklisted: c.isBlacklisted ?? false,
          blacklistReason: c.blacklistReason ?? null,
          blacklistedAt: c.isBlacklisted ? createdAt : null,
          blacklistedBy: c.isBlacklisted ? context.user.name : null,
          cvFileName,
          cvText: text,
          cvVector: fallbackEmbedding(text),
          skillsExtracted: c.skills,
          technologies: c.technologies,
          experienceYears: c.experienceYears,
          education: c.education,
          certifications: c.certifications,
          languages: ["English", "Sinhala"],
          projects: [`${c.technologies[0]} platform rebuild`, "Internal tooling and automation"],
          parseStatus: "parsed",
          createdBy: context.user.id,
          createdAt,
          updatedAt: createdAt,
        });
        await timeline(agencyId, id, "cv_uploaded", "CV uploaded", cvFileName, context.user.name);
        await timeline(agencyId, id, "cv_parsed", "CV parsed by AI", `${c.skills.length} skills extracted`, "Skillton AI");
      }

      /* ------------------------------------------------------------ matches */
      /* Every candidate is matched against every job; the 3rd candidate's
         primary match is backdated past the expiry window on purpose. */
      let expiredDemoRows = 0;
      for (let ci = 0; ci < CANDIDATES.length; ci++) {
        const c = CANDIDATES[ci]!;
        const cVec = fallbackEmbedding(cvText(c));
        if (c.isBlacklisted) continue;
        for (let ji = 0; ji < JOBS.length; ji++) {
          const j = JOBS[ji]!;
          const jVec = fallbackEmbedding(jdText(j));
          let dot = 0;
          for (let k = 0; k < cVec.length; k++) dot += cVec[k]! * jVec[k]!;
          const similarity = Math.max(0, Math.min(1, dot));

          const skills = overlap(j.skills, c.skills);
          const breakdown = computeMatchScore({
            similarity,
            requiredSkills: j.skills,
            matchedSkills: skills.matched,
            candidateExperience: c.experienceYears,
            requiredExperience: j.minExperienceYears,
            candidateEducation: c.education,
            requiredEducation: j.education,
            candidateLocation: c.location,
            jobLocation: j.location,
          });

          /* keep only the primary match plus decent cross-matches. Kasun is the
             deliberately-expired demo case, so he gets no live cross-matches —
             his row must show the "Score expired — re-run match" state. */
          const isPrimary = ji === c.jobIndex;
          if (!isPrimary && (breakdown.total < 45 || c.firstName === "Kasun")) continue;

          const forceExpired = isPrimary && c.firstName === "Kasun";
          const matchedAt = forceExpired
            ? new Date(now - (settings.scoreExpiryDays + 9) * DAY_MS)
            : new Date(now - (ci + 1) * 2 * DAY_MS);
          if (forceExpired) expiredDemoRows++;

          await db.insert(schema.cvJdMatches).values({
            id: newId("mch"),
            agencyId,
            candidateId: candidateIds[ci]!,
            jdId: jobIds[ji]!,
            matchScore: breakdown.total,
            baseScore: breakdown.base,
            skillsMatched: skills.matched,
            skillsMissing: skills.missing,
            technologiesMatched: overlap(j.skills, c.technologies).matched,
            technologiesMissing: overlap(j.skills, c.technologies).missing,
            certificationsMatched: c.certifications,
            certificationsMissing: [],
            strengths: [
              `${c.experienceYears} years of relevant experience`,
              skills.matched.length
                ? `Covers ${skills.matched.length}/${j.skills.length} required skills`
                : "Adjacent skill profile",
            ],
            aiExplanation: `${c.firstName} scores ${breakdown.total} for ${j.title}. Semantic fit contributes ${breakdown.base}, skill coverage ${breakdown.skillBonus} (${skills.matched.length}/${j.skills.length} matched), experience ${breakdown.experienceBonus}, education ${breakdown.educationBonus}, location ${breakdown.locationBonus}.${skills.missing.length ? ` Gaps to probe: ${skills.missing.slice(0, 3).join(", ")}.` : ""}`,
            recommendedFocusAreas: skills.missing.slice(0, 4),
            isShortlisted: isPrimary && breakdown.total >= settings.shortlistThreshold && !forceExpired,
            matchedAt,
            expiresAt: new Date(matchedAt.getTime() + settings.scoreExpiryDays * DAY_MS),
            updatedAt: matchedAt,
          });
        }
      }

      /* ------------------------------------------------------ HR screenings */
      const hrQs = await db
        .select()
        .from(schema.hrQuestions)
        .where(and(eq(schema.hrQuestions.agencyId, agencyId), eq(schema.hrQuestions.isActive, true)));

      const hrTargets = [0, 1, 3, 5, 7, 9];
      for (const idx of hrTargets) {
        const c = CANDIDATES[idx]!;
        const answers: Record<string, string> = {};
        for (const q of hrQs) {
          answers[q.id] =
            q.fieldType === "rating"
              ? String(6 + (idx % 4))
              : q.fieldType === "boolean"
                ? idx % 2 === 0
                  ? "yes"
                  : "no"
                : `Discussed in detail — ${c.firstName} gave a specific, credible answer.`;
        }
        await db.insert(schema.interviewsHr).values({
          id: newId("hri"),
          agencyId,
          candidateId: candidateIds[idx]!,
          jdId: jobIds[c.jobIndex]!,
          recruiterId: context.user.id,
          communicationScore: 6 + (idx % 4),
          salaryExpectation: c.experienceYears > 5 ? "LKR 650,000 / month" : "LKR 420,000 / month",
          noticePeriod: idx % 3 === 0 ? "Immediate" : "1 month",
          willingToRelocate: idx % 2 === 0,
          answers,
          overallNotes: `${c.firstName} presents well, motivations line up with the role and compensation expectations are within range.`,
          result: idx === 8 ? "hold" : "pass",
          conductedAt: new Date(now - (idx + 2) * DAY_MS),
        });
        await timeline(agencyId, candidateIds[idx]!, "hr_screening", "HR screening completed", "Result: pass", context.user.name);
      }

      /* ------------------------------------------------------ AI interviews */
      for (const [name, data] of Object.entries(AI_SUMMARIES)) {
        const idx = CANDIDATES.findIndex((c) => c.firstName === name);
        if (idx < 0) continue;
        const c = CANDIDATES[idx]!;
        await db.insert(schema.interviewsAi).values({
          id: newId("aii"),
          agencyId,
          candidateId: candidateIds[idx]!,
          jdId: jobIds[c.jobIndex]!,
          token: newToken(),
          transcript: [
            { role: "ai", text: `Hi ${c.firstName}, thanks for making time. Tell me about the work you're proudest of in the last year.`, at: now - 5 * DAY_MS },
            { role: "candidate", text: `The piece I'd point to is ${c.technologies[0]} work on our core platform — I owned it from design through rollout.`, at: now - 5 * DAY_MS + 12000 },
            { role: "ai", text: "What was the hardest trade-off you had to make there?", at: now - 5 * DAY_MS + 30000 },
            { role: "candidate", text: "Shipping a simpler model first and accepting some manual work, rather than delaying two months for the ideal design.", at: now - 5 * DAY_MS + 42000 },
            { role: "ai", text: "How did you measure whether it worked?", at: now - 5 * DAY_MS + 60000 },
            { role: "candidate", text: "We tracked error rate and p95 latency before and after, plus the number of manual interventions per week.", at: now - 5 * DAY_MS + 74000 },
          ],
          assessment: { communication: 8, confidence: 7, knowledge: 8, professionalism: 9, criticalThinking: 8, responseConsistency: 8 },
          aiSummary: data.summary,
          strengths: data.strengths,
          weaknesses: data.weaknesses,
          suggestedTechFocus: data.focus,
          selectionReason: `Qualitative signals support advancing ${c.firstName} to the technical round.`,
          topicCoverage: [
            { topic: "Ownership", coverage: 90 },
            { topic: "Communication", coverage: 85 },
            { topic: "Technical depth", coverage: 70 },
            { topic: "Motivation", coverage: 80 },
          ],
          consentGiven: true,
          identityVerified: true,
          status: "completed",
          durationSeconds: 842,
          invitedAt: new Date(now - 6 * DAY_MS),
          conductedAt: new Date(now - 5 * DAY_MS),
          expiresAt: new Date(now + 20 * DAY_MS),
        });
        await timeline(agencyId, candidateIds[idx]!, "ai_interview", "AI voice interview completed", "Qualitative assessment recorded", "Skillton AI");
      }

      /**
       * Live, startable interviews so the queue is populated and every state in
       * the list can be exercised: fresh invites you can open and actually talk
       * to, one part-way through, and one already lapsed.
       */
      const LIVE_AI_INTERVIEWS: {
        name: string;
        status: string;
        invitedDaysAgo: number;
        expiresInDays: number;
        partial?: boolean;
        consent?: boolean;
      }[] = [
        { name: "Kasun", status: "invited", invitedDaysAgo: 0, expiresInDays: 7 },
        { name: "Tharindu", status: "invited", invitedDaysAgo: 0, expiresInDays: 7 },
        { name: "Amaya", status: "invited", invitedDaysAgo: 2, expiresInDays: 5 },
        { name: "Ravi", status: "invited", invitedDaysAgo: 1, expiresInDays: 6 },
        { name: "Sanjay", status: "in_progress", invitedDaysAgo: 1, expiresInDays: 6, partial: true, consent: true },
        { name: "Amaya", status: "expired", invitedDaysAgo: 14, expiresInDays: -3 },
      ];

      for (const entry of LIVE_AI_INTERVIEWS) {
        const idx = CANDIDATES.findIndex((c) => c.firstName === entry.name);
        if (idx < 0) continue;
        const c = CANDIDATES[idx]!;
        await db.insert(schema.interviewsAi).values({
          id: newId("aii"),
          agencyId,
          candidateId: candidateIds[idx]!,
          jdId: jobIds[c.jobIndex]!,
          token: newToken(),
          status: entry.status,
          consentGiven: entry.consent ?? false,
          identityVerified: entry.consent ?? false,
          transcript: entry.partial
            ? [
                {
                  role: "ai",
                  text: `Hi ${c.firstName}, thanks for joining. To start, tell me about what you're working on right now.`,
                  at: now - 40 * 60 * 1000,
                },
                {
                  role: "candidate",
                  text: `I'm building out the ${c.technologies[0]} side of our product — mostly feature work with some refactoring.`,
                  at: now - 39 * 60 * 1000,
                },
              ]
            : undefined,
          invitedAt: new Date(now - entry.invitedDaysAgo * DAY_MS),
          expiresAt: new Date(now + entry.expiresInDays * DAY_MS),
        });
        if (entry.status === "invited" || entry.status === "pending") {
          await timeline(
            agencyId,
            candidateIds[idx]!,
            "ai_interview",
            "AI voice interview invited",
            "Interview link sent to the candidate",
            context.user.name,
          );
        }
      }

      /* ----------------------------------------------- technical interviews */
      const [template] = await db
        .select()
        .from(schema.techTemplates)
        .where(eq(schema.techTemplates.agencyId, agencyId))
        .limit(1);

      const techTargets: { name: string; score: number; rec: string; comments?: string }[] = [
        { name: "Arun", score: 86, rec: "selected" },
        { name: "Dilani", score: 91, rec: "selected" },
        { name: "Amaya", score: 78, rec: "selected" },
        { name: "Ishara", score: 72, rec: "hold" },
        {
          name: "Hasini",
          score: 58,
          rec: "reject",
          comments:
            "Strong AI screening, but the technical round exposed shallow state-management depth and no answer on render performance. Communication was excellent throughout — worth re-testing on a UI-heavy role.",
        },
      ];

      const techByCandidate = new Map<string, number>();
      for (const t of techTargets) {
        const idx = CANDIDATES.findIndex((c) => c.firstName === t.name);
        if (idx < 0) continue;
        const c = CANDIDATES[idx]!;
        const sections = template?.sections ?? [];
        const sectionScores: Record<string, Record<string, number>> = {};
        for (const s of sections) {
          sectionScores[s.name] = Object.fromEntries(
            s.parameters.map((p, pi) => [p, Math.max(5, Math.min(10, Math.round(t.score / 10) + ((pi % 3) - 1)))]),
          );
        }
        techByCandidate.set(candidateIds[idx]!, t.score);
        await db.insert(schema.interviewsTechnical).values({
          id: newId("tci"),
          agencyId,
          candidateId: candidateIds[idx]!,
          jdId: jobIds[c.jobIndex]!,
          interviewerId: context.user.id,
          templateId: template?.id,
          totalScore: t.score,
          sectionScores,
          comments:
            t.comments ??
            `${c.firstName} handled the system design prompt cleanly, reasoned about failure modes unprompted and wrote correct code under time pressure.`,
          selectionReason: `Technical depth is at level for ${c.headline.split("·")[0]!.trim()}.`,
          recommendation: t.rec,
          conductedAt: new Date(now - 2 * DAY_MS),
        });
        await timeline(agencyId, candidateIds[idx]!, "tech_interview", "Technical interview scored", `${t.score}/100 — ${t.rec.replace("_", " ")}`, context.user.name);
      }

      /* --------------------------------------------------------- placements */
      const placedIdx = CANDIDATES.findIndex((c) => c.firstName === "Dilani");
      if (placedIdx >= 0) {
        const c = CANDIDATES[placedIdx]!;
        const candidateId = candidateIds[placedIdx]!;
        const jdId = jobIds[c.jobIndex]!;
        const [match] = await db
          .select()
          .from(schema.cvJdMatches)
          .where(and(eq(schema.cvJdMatches.candidateId, candidateId), eq(schema.cvJdMatches.jdId, jdId)))
          .limit(1);
        const tech = techByCandidate.get(candidateId) ?? null;
        await db.insert(schema.placements).values({
          id: newId("plc"),
          agencyId,
          candidateId,
          jdId,
          clientId: clientIds[c.jobIndex % clientIds.length]!,
          candidateName: `${c.firstName} ${c.lastName}`,
          candidateEmail: c.email,
          positionTitle: JOBS[c.jobIndex]!.title,
          clientName: CLIENTS[c.jobIndex % CLIENTS.length]!.companyName,
          department: JOBS[c.jobIndex]!.department,
          location: JOBS[c.jobIndex]!.location,
          offeredSalary: "LKR 780,000 / month",
          startDate: new Date(now + 14 * DAY_MS),
          placedAt: new Date(now - DAY_MS),
          matchScoreAtHire: match?.matchScore ?? null,
          techScoreAtHire: tech,
          finalScore: finalScore(match?.matchScore ?? null, tech, settings),
          timeToHireDays: 24,
          recruiterId: context.user.id,
          recruiterName: context.user.name,
          status: "active",
          notes: "Offer accepted same day. Client rated the shortlist quality 5/5.",
        });
        await timeline(agencyId, candidateId, "hired", "Marked as hired", "Placement record created", context.user.name);
      }

      /* ------------------------------------ AI interview question sets */
      const QUESTION_SETS: { jobIndex: number; questions: { question: string; followUps: string[] }[] }[] = [
        {
          jobIndex: 0,
          questions: [
            { question: "Walk me through a backend service you owned end to end. What was your specific responsibility?", followUps: ["What was the throughput or scale?", "What would you change if you rebuilt it today?"] },
            { question: "Tell me about a production incident you led the response to. What was the root cause?", followUps: ["How long did detection take?", "What did you change to stop it recurring?"] },
            { question: "How do you keep data consistent across services that each own their own database?", followUps: ["Have you used outbox or saga patterns in production?"] },
            { question: "What draws you to a payments-heavy engineering role specifically?", followUps: [] },
            { question: "What is your current notice period and earliest realistic start date?", followUps: [] },
          ],
        },
        {
          jobIndex: 1,
          questions: [
            { question: "Describe a data warehouse or pipeline you designed. What were the key modelling decisions?", followUps: ["How did you handle late-arriving data?"] },
            { question: "How do you test and monitor data quality in a pipeline you own?", followUps: ["What happens when a test fails at 3am?"] },
            { question: "Tell me about a time a stakeholder disagreed with a metric definition. How did you resolve it?", followUps: [] },
            { question: "What is your experience working in a regulated or audited data environment?", followUps: [] },
            { question: "What are your salary expectations and notice period?", followUps: [] },
          ],
        },
        {
          jobIndex: 3,
          questions: [
            { question: "Tell me about a design system or component library you built or maintained.", followUps: ["How did you drive adoption across teams?"] },
            { question: "How do you approach accessibility beyond automated checks?", followUps: ["Give me a concrete issue you found and fixed."] },
            { question: "Describe a performance problem you diagnosed in a React application.", followUps: ["What did you measure, and with what tool?"] },
            { question: "How do you work with designers when a spec is not technically feasible?", followUps: [] },
            { question: "What is your availability to start?", followUps: [] },
          ],
        },
      ];

      for (const set of QUESTION_SETS) {
        await db.insert(schema.aiQuestionSets).values({
          id: newId("aiqs"),
          agencyId,
          jobTitle: JOBS[set.jobIndex]!.title,
          jdId: jobIds[set.jobIndex]!,
          description: `Screening questions for ${JOBS[set.jobIndex]!.title} — the voice agent may only ask from this set.`,
          questions: set.questions,
          createdBy: context.user.name,
        });
      }

      /* ------------------------------------ client-side interview outcomes */
      const clientOutcomeSeeds: { name: string; outcome: string; feedback: string }[] = [
        { name: "Amaya", outcome: "rejected", feedback: "Excellent technically, but the client wanted someone already onsite in Colombo." },
        { name: "Ishara", outcome: "hold", feedback: "Client is comparing against one internal candidate. Decision expected next week." },
      ];
      for (const seed of clientOutcomeSeeds) {
        const index = CANDIDATES.findIndex((c) => c.firstName === seed.name);
        if (index < 0) continue;
        await db.insert(schema.clientInterviews).values({
          id: newId("cli"),
          agencyId,
          candidateId: candidateIds[index]!,
          jdId: jobIds[CANDIDATES[index]!.jobIndex]!,
          clientId: clientIds[CANDIDATES[index]!.jobIndex % clientIds.length]!,
          outcome: seed.outcome,
          feedback: seed.feedback,
          recordedBy: context.user.name,
        });
      }

      await audit(context.user, "demo.seeded", "agency", agencyId, {
        clients: CLIENTS.length,
        jobs: JOBS.length,
        candidates: CANDIDATES.length,
      });

      return {
        seeded: true,
        clients: CLIENTS.length,
        jobs: JOBS.length,
        candidates: CANDIDATES.length,
        expiredMatches: expiredDemoRows,
        questionSets: QUESTION_SETS.length,
        clientInterviews: clientOutcomeSeeds.length,
        placements: placedIdx >= 0 ? 1 : 0,
      };
    }),
};
