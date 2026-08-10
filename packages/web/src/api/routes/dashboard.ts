import { desc, eq, sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { authed, getSettings } from "../middleware/auth";
import { isExpired } from "../lib/scoring";

const FUNNEL: { key: string; label: string; statuses: string[] }[] = [
  { key: "sourced", label: "Sourced", statuses: ["new"] },
  { key: "shortlisted", label: "AI Shortlisted", statuses: ["shortlisted"] },
  { key: "hr", label: "HR Screening", statuses: ["hr_screening", "hr_selected", "hr_hold"] },
  { key: "ai", label: "AI Interview", statuses: ["ai_interview_pending", "ai_interview_completed"] },
  { key: "tech", label: "Tech Interview", statuses: ["tech_interview_pending", "tech_interview_completed"] },
  { key: "review", label: "Client Review", statuses: ["final_review", "offered"] },
  { key: "hired", label: "Hired", statuses: ["hired"] },
];

export const dashboard = {
  /** Executive dashboard: KPIs, funnel, trends, interview analytics, activity. */
  overview: authed.handler(async ({ context }) => {
    const agencyId = context.agencyId;
    const settings = await getSettings(agencyId);
    const now = new Date();

    const candidateRows = await db
      .select({
        id: schema.candidates.id,
        currentStatus: schema.candidates.currentStatus,
        currentStage: schema.candidates.currentStage,
        createdAt: schema.candidates.createdAt,
        parseStatus: schema.candidates.parseStatus,
      })
      .from(schema.candidates)
      .where(eq(schema.candidates.agencyId, agencyId));

    const jobRows = await db
      .select({
        id: schema.jobDescriptions.id,
        status: schema.jobDescriptions.status,
        priority: schema.jobDescriptions.priority,
        title: schema.jobDescriptions.title,
        createdAt: schema.jobDescriptions.createdAt,
        skillsRequired: schema.jobDescriptions.skillsRequired,
      })
      .from(schema.jobDescriptions)
      .where(eq(schema.jobDescriptions.agencyId, agencyId));

    const matchRows = await db
      .select({
        matchScore: schema.cvJdMatches.matchScore,
        isShortlisted: schema.cvJdMatches.isShortlisted,
        expiresAt: schema.cvJdMatches.expiresAt,
        matchedAt: schema.cvJdMatches.matchedAt,
      })
      .from(schema.cvJdMatches)
      .where(eq(schema.cvJdMatches.agencyId, agencyId));

    const aiRows = await db
      .select({
        status: schema.interviewsAi.status,
        assessment: schema.interviewsAi.assessment,
        durationSeconds: schema.interviewsAi.durationSeconds,
        conductedAt: schema.interviewsAi.conductedAt,
      })
      .from(schema.interviewsAi)
      .where(eq(schema.interviewsAi.agencyId, agencyId));

    const techRows = await db
      .select({
        totalScore: schema.interviewsTechnical.totalScore,
        recommendation: schema.interviewsTechnical.recommendation,
        conductedAt: schema.interviewsTechnical.conductedAt,
      })
      .from(schema.interviewsTechnical)
      .where(eq(schema.interviewsTechnical.agencyId, agencyId));

    const placementRows = await db
      .select({
        placedAt: schema.placements.placedAt,
        timeToHireDays: schema.placements.timeToHireDays,
        clientName: schema.placements.clientName,
        finalScore: schema.placements.finalScore,
      })
      .from(schema.placements)
      .where(eq(schema.placements.agencyId, agencyId));

    const clientCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.clients)
      .where(eq(schema.clients.agencyId, agencyId));

    const activity = await db
      .select()
      .from(schema.candidateEvents)
      .where(eq(schema.candidateEvents.agencyId, agencyId))
      .orderBy(desc(schema.candidateEvents.createdAt))
      .limit(12);

    const liveMatches = matchRows.filter((m) => !isExpired(m.expiresAt, now));
    const expiredMatches = matchRows.length - liveMatches.length;
    const expiringSoon = liveMatches.filter(
      (m) => m.expiresAt.getTime() - now.getTime() <= 7 * 86_400_000,
    ).length;

    const funnel = FUNNEL.map((step) => ({
      key: step.key,
      label: step.label,
      count: candidateRows.filter((c) => step.statuses.includes(c.currentStatus)).length,
    }));

    /* 6-month hiring trend */
    const trend: { month: string; sourced: number; interviewed: number; hired: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const inMonth = (date: Date) =>
        date.getMonth() === d.getMonth() && date.getFullYear() === d.getFullYear();
      trend.push({
        month: d.toLocaleDateString("en-US", { month: "short" }),
        sourced: candidateRows.filter((c) => inMonth(c.createdAt)).length,
        /* Every interview that actually happened that month, AI or technical. */
        interviewed:
          techRows.filter((t) => inMonth(t.conductedAt)).length +
          aiRows.filter((a) => a.conductedAt && inMonth(a.conductedAt)).length,
        hired: placementRows.filter((p) => inMonth(p.placedAt)).length,
      });
    }

    /* Skill demand across open positions */
    const demand = new Map<string, number>();
    for (const job of jobRows.filter((j) => j.status === "open")) {
      for (const skill of job.skillsRequired ?? []) {
        const key = skill.trim();
        if (key) demand.set(key, (demand.get(key) ?? 0) + 1);
      }
    }

    const aiCompleted = aiRows.filter((a) => a.status === "completed");
    const graded = aiCompleted.filter((a) => a.assessment);
    const avg = (pick: (a: NonNullable<typeof graded[number]["assessment"]>) => number) =>
      graded.length
        ? Math.round((graded.reduce((s, a) => s + pick(a.assessment!), 0) / graded.length) * 10) / 10
        : 0;

    const scoreBands = [
      { band: "90-100", count: liveMatches.filter((m) => m.matchScore >= 90).length },
      { band: "80-89", count: liveMatches.filter((m) => m.matchScore >= 80 && m.matchScore < 90).length },
      { band: "70-79", count: liveMatches.filter((m) => m.matchScore >= 70 && m.matchScore < 80).length },
      { band: "60-69", count: liveMatches.filter((m) => m.matchScore >= 60 && m.matchScore < 70).length },
      { band: "<60", count: liveMatches.filter((m) => m.matchScore < 60).length },
    ];

    return {
      kpis: {
        totalCandidates: candidateRows.length,
        parsedCandidates: candidateRows.filter((c) => c.parseStatus === "parsed").length,
        openJobs: jobRows.filter((j) => j.status === "open").length,
        urgentJobs: jobRows.filter((j) => j.status === "open" && j.priority === "urgent").length,
        clients: Number(clientCount[0]?.count ?? 0),
        liveMatches: liveMatches.length,
        expiredMatches,
        expiringSoon,
        shortlisted: liveMatches.filter((m) => m.isShortlisted).length,
        avgMatchScore: liveMatches.length
          ? Math.round((liveMatches.reduce((s, m) => s + m.matchScore, 0) / liveMatches.length) * 10) / 10
          : 0,
        placements: placementRows.length,
        placementsThisMonth: placementRows.filter(
          (p) => p.placedAt.getMonth() === now.getMonth() && p.placedAt.getFullYear() === now.getFullYear(),
        ).length,
        /* Only placements that actually recorded a time-to-hire may average, or a
           single row with a null pulls the whole figure down. */
        avgTimeToHire: (() => {
          const timed = placementRows.filter((p) => p.timeToHireDays != null);
          return timed.length
            ? Math.round(timed.reduce((s, p) => s + (p.timeToHireDays ?? 0), 0) / timed.length)
            : null;
        })(),
        /* Candidates marked hired. Kept beside `placements` so a mismatch between
           the two is visible instead of silently wrong. */
        hiredCandidates: candidateRows.filter((c) => c.currentStatus === "hired").length,
        scoreExpiryDays: settings.scoreExpiryDays,
        shortlistThreshold: settings.shortlistThreshold,
      },
      funnel,
      trend,
      scoreBands,
      skillDemand: [...demand.entries()]
        .map(([skill, count]) => ({ skill, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      aiInterviewStats: {
        invited: aiRows.length,
        completed: aiCompleted.length,
        pending: aiRows.filter((a) => a.status === "pending").length,
        completionRate: aiRows.length ? Math.round((aiCompleted.length / aiRows.length) * 100) : 0,
        avgDurationMinutes: aiCompleted.length
          ? Math.round(
              aiCompleted.reduce((s, a) => s + (a.durationSeconds ?? 0), 0) / aiCompleted.length / 60,
            )
          : 0,
        radar: [
          { dimension: "Communication", score: avg((a) => a.communication) },
          { dimension: "Confidence", score: avg((a) => a.confidence) },
          { dimension: "Knowledge", score: avg((a) => a.knowledge) },
          { dimension: "Professionalism", score: avg((a) => a.professionalism) },
          { dimension: "Critical Thinking", score: avg((a) => a.criticalThinking) },
          { dimension: "Consistency", score: avg((a) => a.responseConsistency) },
        ],
      },
      techInterviewStats: {
        conducted: techRows.length,
        selected: techRows.filter((t) => t.recommendation === "selected").length,
        rejected: techRows.filter((t) => t.recommendation === "rejected").length,
        avgScore: techRows.length
          ? Math.round((techRows.reduce((s, t) => s + t.totalScore, 0) / techRows.length) * 10) / 10
          : 0,
        passRate: techRows.length
          ? Math.round(
              (techRows.filter((t) => t.recommendation === "selected").length / techRows.length) * 100,
            )
          : 0,
      },
      activity,
    };
  }),
};
