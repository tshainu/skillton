import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { authed, getSettings } from "../middleware/auth";

/**
 * Reporting suite. Every report returns plain JSON — KPI cards, table rows and
 * chart series — so the same payload drives the on-screen view, the CSV export
 * and the print/PDF layout without a second query path.
 */

const rangeInput = z
  .object({ days: z.number().min(1).max(1095).default(365) })
  .optional();

function since(days: number) {
  return new Date(Date.now() - days * 86_400_000);
}

function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Count occurrences and return the top N as [{ label, value }]. */
function topCounts(values: (string | null | undefined)[], limit = 12) {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const key = (raw ?? "").trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

function bucketScores(scores: number[]) {
  const bands = [
    { label: "90–100", min: 90, max: 101 },
    { label: "80–90", min: 80, max: 90 },
    { label: "70–80", min: 70, max: 80 },
    { label: "60–70", min: 60, max: 70 },
    { label: "Below 60", min: -1, max: 60 },
  ];
  return bands.map((b) => ({
    label: b.label,
    value: scores.filter((s) => s >= b.min && s < b.max).length,
  }));
}

function stats(values: number[]) {
  if (!values.length) return { count: 0, avg: 0, min: 0, max: 0 };
  return {
    count: values.length,
    avg: round(values.reduce((a, b) => a + b, 0) / values.length),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

/** Load the whole agency dataset once — the reports are cross-cutting. */
async function loadAll(agencyId: string) {
  const [
    clients,
    jobs,
    candidates,
    matches,
    hr,
    ai,
    tech,
    placementRows,
    clientInterviews,
  ] = await Promise.all([
    db.select().from(schema.clients).where(eq(schema.clients.agencyId, agencyId)),
    db.select().from(schema.jobDescriptions).where(eq(schema.jobDescriptions.agencyId, agencyId)),
    db.select().from(schema.candidates).where(eq(schema.candidates.agencyId, agencyId)),
    db.select().from(schema.cvJdMatches).where(eq(schema.cvJdMatches.agencyId, agencyId)),
    db.select().from(schema.interviewsHr).where(eq(schema.interviewsHr.agencyId, agencyId)),
    db.select().from(schema.interviewsAi).where(eq(schema.interviewsAi.agencyId, agencyId)),
    db.select().from(schema.interviewsTechnical).where(eq(schema.interviewsTechnical.agencyId, agencyId)),
    db.select().from(schema.placements).where(eq(schema.placements.agencyId, agencyId)),
    db.select().from(schema.clientInterviews).where(eq(schema.clientInterviews.agencyId, agencyId)),
  ]);
  return { clients, jobs, candidates, matches, hr, ai, tech, placements: placementRows, clientInterviews };
}

type Dataset = Awaited<ReturnType<typeof loadAll>>;

/** Recruitment funnel counts shared by the executive and pipeline reports. */
function funnel(data: Dataset) {
  const matchedIds = new Set(data.matches.map((m) => m.candidateId));
  const hrIds = new Set(data.hr.map((h) => h.candidateId));
  const aiIds = new Set(data.ai.filter((a) => a.status === "completed").map((a) => a.candidateId));
  const techIds = new Set(data.tech.map((t) => t.candidateId));
  const clientIds = new Set(data.clientInterviews.map((c) => c.candidateId));
  const offered = data.placements.length;
  const joined = data.placements.filter((p) => p.status === "active" || p.status === "joined").length;

  return [
    { stage: "CV Uploaded", count: data.candidates.length },
    { stage: "AI Matched", count: matchedIds.size },
    { stage: "HR Screening", count: hrIds.size },
    { stage: "AI Interview", count: aiIds.size },
    { stage: "Technical Interview", count: techIds.size },
    { stage: "Client Interview", count: clientIds.size },
    { stage: "Offered", count: offered },
    { stage: "Joined", count: joined },
  ];
}

export const reports = {
  /** 1 — Executive management dashboard. */
  executive: authed.input(rangeInput).handler(async ({ input, context }) => {
    const data = await loadAll(context.agencyId);
    const from = since(input?.days ?? 365);
    const settings = await getSettings(context.agencyId);

    const activeClientIds = new Set(
      data.jobs.filter((j) => j.status === "open" && j.clientId).map((j) => j.clientId!),
    );
    const openJobs = data.jobs.filter((j) => j.status === "open");
    const inPipeline = data.candidates.filter(
      (c) => !["hired", "rejected", "blacklisted"].includes(c.currentStatus),
    );
    const hired = data.candidates.filter((c) => c.currentStatus === "hired");
    const aiDone = data.ai.filter((a) => a.status === "completed");
    const timeToHire = data.placements
      .map((p) => p.timeToHireDays)
      .filter((d): d is number => d != null);

    /* Matching accuracy: share of shortlisted matches that reached at least the
       technical stage — the engine's own precision. */
    const techIds = new Set(data.tech.map((t) => t.candidateId));
    const shortlisted = data.matches.filter((m) => m.isShortlisted);
    const accurate = shortlisted.filter((m) => techIds.has(m.candidateId)).length;

    const recruiters = topCounts(data.placements.map((p) => p.recruiterName));

    const monthly = new Map<string, number>();
    for (const p of data.placements) {
      if (p.placedAt < from) continue;
      monthly.set(monthKey(p.placedAt), (monthly.get(monthKey(p.placedAt)) ?? 0) + 1);
    }

    const clientCounts = new Map<string, number>();
    for (const p of data.placements) {
      const key = p.clientName ?? "Unassigned";
      clientCounts.set(key, (clientCounts.get(key) ?? 0) + 1);
    }

    const techDemand = topCounts(
      data.jobs.flatMap((j) => [...(j.parsed?.technologies ?? []), ...(j.skillsRequired ?? [])]),
      10,
    );

    return {
      kpis: [
        { label: "Total Clients", value: data.clients.length },
        { label: "Active Clients", value: activeClientIds.size },
        { label: "Open Positions", value: openJobs.length },
        { label: "Total Candidates", value: data.candidates.length },
        { label: "In Pipeline", value: inPipeline.length },
        { label: "Candidates Hired", value: hired.length },
        { label: "AI Interviews", value: aiDone.length },
        { label: "Technical Interviews", value: data.tech.length },
        {
          label: "Placement Success Rate",
          value: pct(data.placements.length, data.candidates.length),
          suffix: "%",
        },
        { label: "Avg Time to Hire", value: stats(timeToHire).avg, suffix: " days" },
        {
          label: "Recruiter Productivity",
          value: recruiters.length ? round(data.placements.length / recruiters.length) : 0,
          suffix: " / recruiter",
        },
        { label: "AI Matching Accuracy", value: pct(accurate, shortlisted.length), suffix: "%" },
      ],
      funnel: funnel(data),
      monthlyHiring: [...monthly.entries()].sort().map(([label, value]) => ({ label, value })),
      jobStatus: topCounts(data.jobs.map((j) => j.status), 8),
      pipelineByStage: topCounts(inPipeline.map((c) => c.currentStage), 10),
      recruiterPerformance: recruiters,
      clientWise: [...clientCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([label, value]) => ({ label, value })),
      technologyDemand: techDemand,
      candidateSources: topCounts(data.candidates.map((c) => c.source), 10),
      shortlistThreshold: settings.shortlistThreshold,
    };
  }),

  /** 2 — Recruitment pipeline report. */
  pipeline: authed.handler(async ({ context }) => {
    const data = await loadAll(context.agencyId);
    const stages = funnel(data);
    const first = stages[0]?.count ?? 0;

    const rows = stages.map((s, i) => {
      const prev = i === 0 ? s.count : (stages[i - 1]?.count ?? 0);
      return {
        stage: s.stage,
        candidates: s.count,
        ofTotal: pct(s.count, first),
        conversion: i === 0 ? 100 : pct(s.count, prev),
        dropOff: i === 0 ? 0 : Math.max(0, prev - s.count),
      };
    });

    return {
      rows,
      totalEntering: first,
      totalJoined: stages.at(-1)?.count ?? 0,
      overallConversion: pct(stages.at(-1)?.count ?? 0, first),
      biggestDropOff: [...rows].sort((a, b) => b.dropOff - a.dropOff)[0] ?? null,
    };
  }),

  /** 3 — Job description performance. */
  jdPerformance: authed.handler(async ({ context }) => {
    const data = await loadAll(context.agencyId);
    const hrByCandidate = new Map(data.hr.map((h) => [h.candidateId, h]));
    const aiDone = new Set(data.ai.filter((a) => a.status === "completed").map((a) => a.candidateId));
    const techByCandidate = new Map(data.tech.map((t) => [t.candidateId, t]));
    const clientPassed = new Set(
      data.clientInterviews.filter((c) => c.outcome === "placed").map((c) => c.candidateId),
    );
    const clientName = new Map(data.clients.map((c) => [c.id, c.companyName]));

    const rows = data.jobs.map((job) => {
      const jobMatches = data.matches.filter((m) => m.jdId === job.id);
      const scores = jobMatches.map((m) => m.matchScore);
      const candidateIds = jobMatches.map((m) => m.candidateId);
      const hrSelected = candidateIds.filter((id) => hrByCandidate.get(id)?.result === "selected").length;
      const aiCompleted = candidateIds.filter((id) => aiDone.has(id)).length;
      const techPassed = candidateIds.filter(
        (id) => techByCandidate.get(id)?.recommendation === "proceed",
      ).length;
      const clientPassedCount = candidateIds.filter((id) => clientPassed.has(id)).length;
      const jobPlacements = data.placements.filter((p) => p.jdId === job.id);
      const fillDays = jobPlacements.map((p) => p.timeToHireDays).filter((d): d is number => d != null);

      return {
        jdId: job.id,
        title: job.title,
        clientName: job.clientId ? (clientName.get(job.clientId) ?? null) : null,
        status: job.status,
        openings: job.openings,
        cvsReceived: jobMatches.length,
        aiMatched: jobMatches.filter((m) => m.isShortlisted).length,
        avgMatchScore: stats(scores).avg,
        scoreDistribution: bucketScores(scores),
        hrSelected,
        aiCompleted,
        techPassed,
        clientPassed: clientPassedCount,
        offerRate: pct(jobPlacements.length, jobMatches.length),
        joiningRate: pct(jobPlacements.filter((p) => p.status !== "dropped").length, jobPlacements.length),
        timeToFillDays: stats(fillDays).avg,
      };
    });

    return { rows: rows.sort((a, b) => b.cvsReceived - a.cvsReceived) };
  }),

  /** 4 — Recruiter performance + leaderboard. */
  recruiterPerformance: authed.handler(async ({ context }) => {
    const data = await loadAll(context.agencyId);
    const users = await db
      .select({ id: schema.user.id, name: schema.user.name, role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.agencyId, context.agencyId));

    const byName = new Map<string, { name: string; processed: number; interviews: number; selections: number; placements: number; scores: number[]; times: number[]; rejected: number; hold: number }>();
    const ensure = (name: string) => {
      if (!byName.has(name))
        byName.set(name, {
          name,
          processed: 0,
          interviews: 0,
          selections: 0,
          placements: 0,
          scores: [],
          times: [],
          rejected: 0,
          hold: 0,
        });
      return byName.get(name)!;
    };
    for (const u of users) ensure(u.name);

    const userName = new Map(users.map((u) => [u.id, u.name]));

    for (const h of data.hr) {
      const name = h.recruiterId ? userName.get(h.recruiterId) : undefined;
      if (!name) continue;
      const row = ensure(name);
      row.processed++;
      row.interviews++;
      if (h.result === "selected") row.selections++;
      else if (h.result === "rejected") row.rejected++;
      else row.hold++;
    }
    for (const t of data.tech) {
      const name = t.interviewerId ? userName.get(t.interviewerId) : undefined;
      if (!name) continue;
      const row = ensure(name);
      row.interviews++;
      row.scores.push(t.totalScore);
      if (t.recommendation === "proceed") row.selections++;
      else if (t.recommendation === "reject") row.rejected++;
      else row.hold++;
    }
    for (const p of data.placements) {
      const name = p.recruiterName ?? (p.recruiterId ? userName.get(p.recruiterId) : undefined);
      if (!name) continue;
      const row = ensure(name);
      row.placements++;
      if (p.finalScore != null) row.scores.push(p.finalScore);
      if (p.timeToHireDays != null) row.times.push(p.timeToHireDays);
    }

    const rows = [...byName.values()].map((r) => {
      const decisions = r.selections + r.rejected + r.hold;
      return {
        name: r.name,
        candidatesProcessed: r.processed,
        interviewsConducted: r.interviews,
        selections: r.selections,
        placements: r.placements,
        avgTimeDays: stats(r.times).avg,
        avgCandidateScore: stats(r.scores).avg,
        rejectedPct: pct(r.rejected, decisions),
        holdPct: pct(r.hold, decisions),
        productivityPct: pct(r.placements, Math.max(1, r.processed)),
      };
    });

    return {
      rows: rows.sort((a, b) => b.placements - a.placements || b.selections - a.selections),
      leaderboard: rows
        .map((r) => ({ name: r.name, score: r.placements * 3 + r.selections }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10),
    };
  }),

  /** 5 — Client performance. */
  clientPerformance: authed.handler(async ({ context }) => {
    const data = await loadAll(context.agencyId);
    const matchByCandidate = new Map<string, number>();
    for (const m of data.matches) {
      matchByCandidate.set(m.candidateId, Math.max(matchByCandidate.get(m.candidateId) ?? 0, m.matchScore));
    }

    const rows = data.clients.map((client) => {
      const jobs = data.jobs.filter((j) => j.clientId === client.id);
      const jobIds = new Set(jobs.map((j) => j.id));
      const placementRows = data.placements.filter((p) => p.clientId === client.id);
      const interviews = data.clientInterviews.filter((c) => c.clientId === client.id);
      const candidateIds = data.matches.filter((m) => jobIds.has(m.jdId)).map((m) => m.candidateId);
      const scores = candidateIds
        .map((id) => matchByCandidate.get(id))
        .filter((s): s is number => s != null);
      const fillDays = placementRows.map((p) => p.timeToHireDays).filter((d): d is number => d != null);

      return {
        clientId: client.id,
        companyName: client.companyName,
        industry: client.industry,
        relationshipStatus: client.relationshipStatus,
        accountManager: client.accountManager,
        openPositions: jobs.filter((j) => j.status === "open").length,
        filledPositions: placementRows.length,
        timeToFillDays: stats(fillDays).avg,
        avgCandidateScore: stats(scores).avg,
        interviewRatio: pct(interviews.length, candidateIds.length),
        offerRatio: pct(placementRows.length, Math.max(1, interviews.length)),
        joiningRatio: pct(placementRows.filter((p) => p.status !== "dropped").length, placementRows.length),
        repeatBusiness: jobs.length > 1,
        totalRoles: jobs.length,
      };
    });

    return { rows: rows.sort((a, b) => b.filledPositions - a.filledPositions) };
  }),

  /** 6 — Placement report, monthly / quarterly / yearly. */
  placementReport: authed
    .input(z.object({ period: z.enum(["monthly", "quarterly", "yearly"]).default("monthly") }).optional())
    .handler(async ({ input, context }) => {
      const data = await loadAll(context.agencyId);
      const period = input?.period ?? "monthly";

      const keyOf = (d: Date) => {
        if (period === "yearly") return String(d.getFullYear());
        if (period === "quarterly") return `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`;
        return monthKey(d);
      };

      const grouped = new Map<string, { offers: number; joined: number; dropouts: number }>();
      for (const p of data.placements) {
        const key = keyOf(p.placedAt);
        const row = grouped.get(key) ?? { offers: 0, joined: 0, dropouts: 0 };
        row.offers++;
        if (p.status === "dropped") row.dropouts++;
        else row.joined++;
        grouped.set(key, row);
      }

      const rejected = data.clientInterviews.filter((c) => c.outcome === "rejected").length;

      return {
        period,
        rows: [...grouped.entries()]
          .sort()
          .map(([label, r]) => ({ ...r, label, successPct: pct(r.joined, r.offers) })),
        totals: {
          offers: data.placements.length,
          accepted: data.placements.filter((p) => p.status !== "dropped").length,
          rejected,
          joined: data.placements.filter((p) => p.status !== "dropped").length,
          dropouts: data.placements.filter((p) => p.status === "dropped").length,
          successPct: pct(
            data.placements.filter((p) => p.status !== "dropped").length,
            data.placements.length,
          ),
        },
        byDepartment: topCounts(data.placements.map((p) => p.department)),
        byClient: topCounts(data.placements.map((p) => p.clientName)),
        byRecruiter: topCounts(data.placements.map((p) => p.recruiterName)),
        /* Who was placed where. The aggregate rows answer "how many"; a placement
           report is only usable to a client or an auditor if it also names the
           person, the role, the employer and the money. */
        detail: [...data.placements]
          .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())
          .map((p) => ({
            id: p.id,
            candidateId: p.candidateId,
            candidateName: p.candidateName,
            candidateEmail: p.candidateEmail,
            positionTitle: p.positionTitle,
            clientName: p.clientName,
            department: p.department,
            location: p.location,
            offeredSalary: p.offeredSalary,
            salaryCurrency: p.salaryCurrency,
            offeredSalaryAmount: p.offeredSalaryAmount,
            startDate: p.startDate,
            placedAt: p.placedAt,
            period: keyOf(p.placedAt),
            matchScoreAtHire: p.matchScoreAtHire,
            techScoreAtHire: p.techScoreAtHire,
            finalScore: p.finalScore,
            timeToHireDays: p.timeToHireDays,
            recruiterName: p.recruiterName,
            status: p.status,
            notes: p.notes,
          })),
      };
    }),

  /** 7 — Candidate analytics. */
  candidateAnalytics: authed.input(rangeInput).handler(async ({ input, context }) => {
    const from = since(input?.days ?? 365);
    const data = await loadAll(context.agencyId);

    const growth = new Map<string, number>();
    for (const c of data.candidates) {
      if (c.createdAt < from) continue;
      growth.set(monthKey(c.createdAt), (growth.get(monthKey(c.createdAt)) ?? 0) + 1);
    }

    const expBands = [
      { label: "0–2 yrs", min: 0, max: 2 },
      { label: "2–5 yrs", min: 2, max: 5 },
      { label: "5–8 yrs", min: 5, max: 8 },
      { label: "8–12 yrs", min: 8, max: 12 },
      { label: "12+ yrs", min: 12, max: 100 },
    ];

    const skills = topCounts(data.candidates.flatMap((c) => c.skillsExtracted ?? []), 20);
    const maxSkill = skills[0]?.value ?? 1;

    return {
      totalCandidates: data.candidates.length,
      newInPeriod: data.candidates.filter((c) => c.createdAt >= from).length,
      growth: [...growth.entries()].sort().map(([label, value]) => ({ label, value })),
      experienceDistribution: expBands.map((b) => ({
        label: b.label,
        value: data.candidates.filter(
          (c) => (c.experienceYears ?? 0) >= b.min && (c.experienceYears ?? 0) < b.max,
        ).length,
      })),
      educationDistribution: topCounts(data.candidates.flatMap((c) => c.education ?? []), 10),
      technologyDistribution: topCounts(data.candidates.flatMap((c) => c.technologies ?? []), 15),
      locationDistribution: topCounts(data.candidates.map((c) => c.location), 12),
      skillsHeatMap: skills.map((s) => ({ ...s, intensity: Math.round((s.value / maxSkill) * 100) })),
      certifications: topCounts(data.candidates.flatMap((c) => c.certifications ?? []), 12),
      languages: topCounts(data.candidates.flatMap((c) => c.languages ?? []), 10),
      sources: topCounts(data.candidates.map((c) => c.source), 10),
      buckets: topCounts(data.candidates.map((c) => c.bucket), 6),
    };
  }),

  /** 8 — AI matching analytics. */
  aiMatchingAnalytics: authed.handler(async ({ context }) => {
    const data = await loadAll(context.agencyId);
    const settings = await getSettings(context.agencyId);
    const scores = data.matches.map((m) => m.matchScore);
    const techIds = new Set(data.tech.map((t) => t.candidateId));
    const shortlisted = data.matches.filter((m) => m.isShortlisted);
    const accurate = shortlisted.filter((m) => techIds.has(m.candidateId)).length;

    /* A recruiter override is a shortlisted match the recruiter rejected, or a
       non-shortlisted candidate they pushed through anyway. */
    const hrByCandidate = new Map(data.hr.map((h) => [h.candidateId, h.result]));
    let overrides = 0;
    for (const m of data.matches) {
      const decision = hrByCandidate.get(m.candidateId);
      if (!decision) continue;
      if (m.isShortlisted && decision === "rejected") overrides++;
      if (!m.isShortlisted && decision === "selected") overrides++;
    }

    const s = stats(scores);
    const aiDone = data.ai.filter((a) => a.status === "completed");
    const durations = aiDone.map((a) => a.durationSeconds ?? 0).filter((d) => d > 0);

    const assessAvg = (key: keyof NonNullable<(typeof aiDone)[number]["assessment"]>) => {
      const values = aiDone.map((a) => a.assessment?.[key]).filter((v): v is number => v != null);
      return stats(values).avg;
    };

    return {
      totalMatches: data.matches.length,
      averageScore: s.avg,
      highestScore: s.max,
      lowestScore: s.min,
      scoreDistribution: bucketScores(scores),
      shortlistedCount: shortlisted.length,
      shortlistThreshold: settings.shortlistThreshold,
      matchingAccuracy: pct(accurate, shortlisted.length),
      recruiterOverridePct: pct(overrides, data.matches.length),
      topSkills: topCounts(data.matches.flatMap((m) => m.skillsMatched ?? []), 12),
      missingSkills: topCounts(data.matches.flatMap((m) => m.skillsMissing ?? []), 12),
      topTechnologies: topCounts(data.matches.flatMap((m) => m.technologiesMatched ?? []), 12),
      topCertifications: topCounts(data.candidates.flatMap((c) => c.certifications ?? []), 10),
      mostRequestedTechnologies: topCounts(
        data.jobs.flatMap((j) => j.parsed?.technologies ?? j.skillsRequired ?? []),
        12,
      ),
      aiInterviews: {
        total: data.ai.length,
        completed: aiDone.length,
        cancelled: data.ai.filter((a) => a.status === "cancelled").length,
        avgDurationMinutes: durations.length ? round(stats(durations).avg / 60) : 0,
        avgCommunication: assessAvg("communication"),
        avgConfidence: assessAvg("confidence"),
        avgKnowledge: assessAvg("knowledge"),
        topStrengths: topCounts(aiDone.flatMap((a) => a.strengths ?? []), 8),
        topWeaknesses: topCounts(aiDone.flatMap((a) => a.weaknesses ?? []), 8),
      },
      technical: {
        ...stats(data.tech.map((t) => t.totalScore)),
        sentimentAdjusted: data.tech.filter((t) => t.sentimentAdjustment !== 0).length,
        positive: data.tech.filter((t) => t.commentSentiment === "positive").length,
        negative: data.tech.filter((t) => t.commentSentiment === "negative").length,
      },
    };
  }),

  /** Catalogue driving the Reports menu. */
  catalogue: authed.handler(async ({ context }) => {
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.candidates)
      .where(
        and(
          eq(schema.candidates.agencyId, context.agencyId),
          gte(schema.candidates.createdAt, since(30)),
        ),
      );
    const [latest] = await db
      .select({ at: schema.placements.placedAt })
      .from(schema.placements)
      .where(eq(schema.placements.agencyId, context.agencyId))
      .orderBy(desc(schema.placements.placedAt))
      .limit(1);
    return { newCandidates30d: Number(count), lastPlacementAt: latest?.at ?? null };
  }),
};
