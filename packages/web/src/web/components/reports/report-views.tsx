import { useEffect } from "react";
import { Link } from "wouter";
import { Card, SectionTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard, TableShell, Td, Th, Tr } from "@/components/ui/page";
import { ScorePill } from "@/components/ui/score";
import { BarList, Donut, Funnel, HeatMap, ScoreHistogram, TrendLine } from "@/components/ui/chart";
import { LoadingBlock } from "@/components/ui/feedback";
import { formatNumber, titleCase } from "@/lib/labels";
import { formatMoney } from "@/lib/currency";
import type { CsvValue } from "@/lib/export";
import {
  useAiMatchingAnalyticsReport,
  useCandidateAnalyticsReport,
  useClientPerformanceReport,
  useExecutiveReport,
  useJdPerformanceReport,
  usePipelineReport,
  usePlacementReport,
  useRecruiterPerformanceReport,
} from "@/queries/reports";

/**
 * The eight report bodies. Each one registers the flat table it would export,
 * so the shell's CSV button always matches exactly what is on screen.
 */

export interface ExportPayload {
  headers: string[];
  rows: CsvValue[][];
}

export interface ReportViewProps {
  register: (payload: ExportPayload) => void;
  period?: "monthly" | "quarterly" | "yearly";
}

/** Register the CSV payload whenever the data changes. */
function useRegister(register: (p: ExportPayload) => void, payload: ExportPayload | null) {
  const serialised = payload ? JSON.stringify(payload) : "";
  useEffect(() => {
    if (serialised) register(JSON.parse(serialised) as ExportPayload);
  }, [serialised, register]);
}

function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div className={cols === 3 ? "grid gap-4 lg:grid-cols-3" : "grid gap-4 lg:grid-cols-2"}>{children}</div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <SectionTitle title={title} hint={hint} />
      {children}
    </Card>
  );
}

/* -------------------------------------------------- 1. Executive dashboard */

export function ExecutiveReport({ register }: ReportViewProps) {
  const { data, isLoading } = useExecutiveReport();

  useRegister(
    register,
    data
      ? {
          headers: ["Metric", "Value"],
          rows: [
            ...data.kpis.map((k) => [k.label, `${k.value}${k.suffix ?? ""}`] as CsvValue[]),
            ...data.funnel.map((f) => [`Funnel — ${f.stage}`, f.count] as CsvValue[]),
          ],
        }
      : null,
  );

  if (isLoading || !data) return <LoadingBlock rows={6} />;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.kpis.map((kpi) => (
          <StatCard
            key={kpi.label}
            label={kpi.label}
            value={`${formatNumber(kpi.value)}${kpi.suffix ?? ""}`}
            tone={kpi.label.includes("Rate") || kpi.label.includes("Accuracy") ? "success" : "default"}
          />
        ))}
      </div>

      <Grid>
        <Panel title="Recruitment funnel" hint="Stage counts with conversion from the previous stage">
          <Funnel data={data.funnel} />
        </Panel>
        <Panel title="Monthly hiring trend" hint="Placements per month">
          <TrendLine data={data.monthlyHiring} />
        </Panel>
      </Grid>

      <Grid cols={3}>
        <Panel title="Job status distribution">
          <Donut data={data.jobStatus.map((j) => ({ ...j, label: titleCase(j.label) }))} size={120} />
        </Panel>
        <Panel title="Candidate pipeline by stage">
          <BarList data={data.pipelineByStage.map((p) => ({ ...p, label: titleCase(p.label) }))} />
        </Panel>
        <Panel title="Candidate source analysis">
          <BarList data={data.candidateSources.map((s) => ({ ...s, label: titleCase(s.label) }))} />
        </Panel>
      </Grid>

      <Grid cols={3}>
        <Panel title="Recruiter performance" hint="Placements per recruiter">
          <BarList data={data.recruiterPerformance} />
        </Panel>
        <Panel title="Client-wise recruitment">
          <BarList data={data.clientWise} />
        </Panel>
        <Panel title="Technology demand" hint="Most requested across open JDs">
          <BarList data={data.technologyDemand} />
        </Panel>
      </Grid>
    </div>
  );
}

/* --------------------------------------------------- 2. Recruitment pipeline */

export function PipelineReport({ register }: ReportViewProps) {
  const { data, isLoading } = usePipelineReport();

  useRegister(
    register,
    data
      ? {
          headers: ["Stage", "Candidates", "% of total", "Conversion %", "Drop-off"],
          rows: data.rows.map((r) => [r.stage, r.candidates, r.ofTotal, r.conversion, r.dropOff]),
        }
      : null,
  );

  if (isLoading || !data) return <LoadingBlock rows={6} />;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Entering pipeline" value={data.totalEntering} />
        <StatCard label="Joined" value={data.totalJoined} tone="success" />
        <StatCard label="Overall conversion" value={`${data.overallConversion}%`} tone="primary" />
        <StatCard
          label="Biggest drop-off"
          value={data.biggestDropOff?.stage ?? "—"}
          hint={data.biggestDropOff ? `${data.biggestDropOff.dropOff} candidates lost` : undefined}
          tone="danger"
        />
      </div>

      <Panel title="Funnel" hint="Conversion shown against the previous stage">
        <Funnel data={data.rows.map((r) => ({ stage: r.stage, count: r.candidates }))} />
      </Panel>

      <TableShell>
        <thead>
          <tr>
            <Th>Stage</Th>
            <Th>Candidates</Th>
            <Th>% of total</Th>
            <Th>Conversion</Th>
            <Th>Drop-off</Th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <Tr key={row.stage}>
              <Td className="font-medium">{row.stage}</Td>
              <Td className="num">{row.candidates.toLocaleString()}</Td>
              <Td className="num">{row.ofTotal}%</Td>
              <Td className="num">{row.conversion}%</Td>
              <Td className="num text-destructive">{row.dropOff || "—"}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

/* ------------------------------------------------- 3. JD performance report */

export function JdPerformanceReport({ register }: ReportViewProps) {
  const { data, isLoading } = useJdPerformanceReport();

  useRegister(
    register,
    data
      ? {
          headers: [
            "Job title",
            "Client",
            "Status",
            "Openings",
            "CVs received",
            "AI matched",
            "Avg match score",
            "HR selected",
            "AI interviews",
            "Technical passed",
            "Client passed",
            "Offer rate %",
            "Joining rate %",
            "Time to fill (days)",
          ],
          rows: data.rows.map((r) => [
            r.title,
            r.clientName,
            titleCase(r.status),
            r.openings,
            r.cvsReceived,
            r.aiMatched,
            r.avgMatchScore,
            r.hrSelected,
            r.aiCompleted,
            r.techPassed,
            r.clientPassed,
            r.offerRate,
            r.joiningRate,
            r.timeToFillDays,
          ]),
        }
      : null,
  );

  if (isLoading || !data) return <LoadingBlock rows={6} />;

  return (
    <div className="space-y-5">
      <TableShell>
        <thead>
          <tr>
            <Th>Job description</Th>
            <Th>Client</Th>
            <Th>CVs</Th>
            <Th>Matched</Th>
            <Th>Avg score</Th>
            <Th>HR</Th>
            <Th>AI</Th>
            <Th>Tech</Th>
            <Th>Client</Th>
            <Th>Offer %</Th>
            <Th>Join %</Th>
            <Th>Fill days</Th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <Tr key={row.jdId}>
              <Td>
                <Link href={`/jobs/${row.jdId}`} className="font-medium hover:text-primary">
                  {row.title}
                </Link>
                <span className="block text-[11px] text-muted-foreground">
                  {titleCase(row.status)} · {row.openings} opening(s)
                </span>
              </Td>
              <Td className="text-muted-foreground">{row.clientName ?? "—"}</Td>
              <Td className="num">{row.cvsReceived}</Td>
              <Td className="num">{row.aiMatched}</Td>
              <Td>
                <ScorePill score={row.avgMatchScore || null} />
              </Td>
              <Td className="num">{row.hrSelected}</Td>
              <Td className="num">{row.aiCompleted}</Td>
              <Td className="num">{row.techPassed}</Td>
              <Td className="num">{row.clientPassed}</Td>
              <Td className="num">{row.offerRate}%</Td>
              <Td className="num">{row.joiningRate}%</Td>
              <Td className="num">{row.timeToFillDays || "—"}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      {data.rows.slice(0, 4).map((row) => (
        <Panel key={row.jdId} title={`${row.title} — match score distribution`}>
          <ScoreHistogram data={row.scoreDistribution} />
        </Panel>
      ))}
    </div>
  );
}

/* ---------------------------------------------------- 4. Candidate analytics */

export function CandidateAnalyticsReport({ register }: ReportViewProps) {
  const { data, isLoading } = useCandidateAnalyticsReport();

  useRegister(
    register,
    data
      ? {
          headers: ["Dimension", "Label", "Candidates"],
          rows: [
            ...data.experienceDistribution.map((d) => ["Experience", d.label, d.value] as CsvValue[]),
            ...data.educationDistribution.map((d) => ["Education", d.label, d.value] as CsvValue[]),
            ...data.technologyDistribution.map((d) => ["Technology", d.label, d.value] as CsvValue[]),
            ...data.locationDistribution.map((d) => ["Location", d.label, d.value] as CsvValue[]),
            ...data.sources.map((d) => ["Source", titleCase(d.label), d.value] as CsvValue[]),
            ...data.certifications.map((d) => ["Certification", d.label, d.value] as CsvValue[]),
            ...data.languages.map((d) => ["Language", d.label, d.value] as CsvValue[]),
          ],
        }
      : null,
  );

  if (isLoading || !data) return <LoadingBlock rows={6} />;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total candidates" value={data.totalCandidates} tone="primary" />
        <StatCard label="New in period" value={data.newInPeriod} tone="success" />
        <StatCard label="Distinct technologies" value={data.technologyDistribution.length} />
      </div>

      <Panel title="Candidate growth" hint="New registrations per month">
        <TrendLine data={data.growth} />
      </Panel>

      <Grid>
        <Panel title="Experience distribution">
          <Donut data={data.experienceDistribution} />
        </Panel>
        <Panel title="Education distribution">
          <BarList data={data.educationDistribution} />
        </Panel>
      </Grid>

      <Grid>
        <Panel title="Technology distribution">
          <BarList data={data.technologyDistribution} />
        </Panel>
        <Panel title="Location distribution">
          <BarList data={data.locationDistribution} />
        </Panel>
      </Grid>

      <Panel title="Skills heat map" hint="Shading shows relative frequency across the candidate pool">
        <HeatMap data={data.skillsHeatMap} />
      </Panel>

      <Grid cols={3}>
        <Panel title="Certifications">
          <BarList data={data.certifications} />
        </Panel>
        <Panel title="Languages">
          <BarList data={data.languages} />
        </Panel>
        <Panel title="Sources">
          <Donut data={data.sources.map((s) => ({ ...s, label: titleCase(s.label) }))} size={120} />
        </Panel>
      </Grid>
    </div>
  );
}

/* ------------------------------------------------- 5. AI matching analytics */

export function AiMatchingReport({ register }: ReportViewProps) {
  const { data, isLoading } = useAiMatchingAnalyticsReport();

  useRegister(
    register,
    data
      ? {
          headers: ["Metric", "Value"],
          rows: [
            ["Total matches", data.totalMatches],
            ["Average match score", data.averageScore],
            ["Highest match score", data.highestScore],
            ["Lowest match score", data.lowestScore],
            ["Shortlisted", data.shortlistedCount],
            ["Shortlist threshold", data.shortlistThreshold],
            ["AI matching accuracy %", data.matchingAccuracy],
            ["Recruiter override %", data.recruiterOverridePct],
            ["AI interviews completed", data.aiInterviews.completed],
            ["Average AI interview duration (min)", data.aiInterviews.avgDurationMinutes],
            ["Average communication", data.aiInterviews.avgCommunication],
            ["Average confidence", data.aiInterviews.avgConfidence],
            ["Average knowledge", data.aiInterviews.avgKnowledge],
            ["Average technical score", data.technical.avg],
            ["Technical scores adjusted by comment", data.technical.sentimentAdjusted],
          ],
        }
      : null,
  );

  if (isLoading || !data) return <LoadingBlock rows={6} />;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Average match score" value={data.averageScore} tone="primary" />
        <StatCard label="Highest" value={data.highestScore} tone="success" />
        <StatCard label="Lowest" value={data.lowestScore} tone="danger" />
        <StatCard label="Total matches" value={data.totalMatches} />
        <StatCard label="Matching accuracy" value={`${data.matchingAccuracy}%`} tone="success" />
        <StatCard
          label="Recruiter override"
          value={`${data.recruiterOverridePct}%`}
          hint="Recruiter disagreed with the engine"
          tone="warning"
        />
        <StatCard label="Shortlisted" value={data.shortlistedCount} hint={`Threshold ${data.shortlistThreshold}`} />
        <StatCard
          label="Comment-adjusted scores"
          value={data.technical.sentimentAdjusted}
          hint={`${data.technical.positive} positive · ${data.technical.negative} negative`}
          tone="info"
        />
      </div>

      <Panel title="Match score distribution">
        <ScoreHistogram data={data.scoreDistribution} />
      </Panel>

      <Grid>
        <Panel title="Top matched skills">
          <BarList data={data.topSkills} />
        </Panel>
        <Panel title="Most common missing skills" hint="Where the market is short">
          <BarList data={data.missingSkills} color="#ef4444" />
        </Panel>
      </Grid>

      <Grid>
        <Panel title="Top technologies in matched CVs">
          <BarList data={data.topTechnologies} />
        </Panel>
        <Panel title="Most requested technologies in JDs">
          <BarList data={data.mostRequestedTechnologies} />
        </Panel>
      </Grid>

      <Grid cols={3}>
        <Panel title="AI interview quality" hint="Averages across completed interviews">
          <BarList
            max={10}
            data={[
              { label: "Communication", value: data.aiInterviews.avgCommunication },
              { label: "Confidence", value: data.aiInterviews.avgConfidence },
              { label: "Knowledge", value: data.aiInterviews.avgKnowledge },
            ]}
          />
          <p className="mt-3 text-[12px] text-muted-foreground">
            {data.aiInterviews.completed} completed · {data.aiInterviews.avgDurationMinutes} min average
          </p>
        </Panel>
        <Panel title="Top strengths">
          <BarList data={data.aiInterviews.topStrengths} color="#10b981" />
        </Panel>
        <Panel title="Top weaknesses">
          <BarList data={data.aiInterviews.topWeaknesses} color="#f59e0b" />
        </Panel>
      </Grid>
    </div>
  );
}

/* --------------------------------------------------- 6. Recruiter performance */

export function RecruiterPerformanceReport({ register }: ReportViewProps) {
  const { data, isLoading } = useRecruiterPerformanceReport();

  useRegister(
    register,
    data
      ? {
          headers: [
            "Recruiter",
            "Candidates processed",
            "Interviews conducted",
            "Selections",
            "Placements",
            "Avg time (days)",
            "Avg candidate score",
            "Rejected %",
            "Hold %",
            "Productivity %",
          ],
          rows: data.rows.map((r) => [
            r.name,
            r.candidatesProcessed,
            r.interviewsConducted,
            r.selections,
            r.placements,
            r.avgTimeDays,
            r.avgCandidateScore,
            r.rejectedPct,
            r.holdPct,
            r.productivityPct,
          ]),
        }
      : null,
  );

  if (isLoading || !data) return <LoadingBlock rows={6} />;

  return (
    <div className="space-y-5">
      <Panel title="Leaderboard" hint="Placements weighted x3, plus selections">
        <BarList data={data.leaderboard.map((l) => ({ label: l.name, value: l.score }))} />
      </Panel>

      <TableShell>
        <thead>
          <tr>
            <Th>Recruiter</Th>
            <Th>Processed</Th>
            <Th>Interviews</Th>
            <Th>Selections</Th>
            <Th>Placements</Th>
            <Th>Avg days</Th>
            <Th>Avg score</Th>
            <Th>Rejected</Th>
            <Th>Hold</Th>
            <Th>Productivity</Th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <Tr key={row.name}>
              <Td className="font-medium">{row.name}</Td>
              <Td className="num">{row.candidatesProcessed}</Td>
              <Td className="num">{row.interviewsConducted}</Td>
              <Td className="num">{row.selections}</Td>
              <Td className="num">{row.placements}</Td>
              <Td className="num">{row.avgTimeDays || "—"}</Td>
              <Td>
                <ScorePill score={row.avgCandidateScore || null} />
              </Td>
              <Td className="num">{row.rejectedPct}%</Td>
              <Td className="num">{row.holdPct}%</Td>
              <Td className="num">{row.productivityPct}%</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

/* ------------------------------------------------------ 7. Client performance */

export function ClientPerformanceReport({ register }: ReportViewProps) {
  const { data, isLoading } = useClientPerformanceReport();

  useRegister(
    register,
    data
      ? {
          headers: [
            "Client",
            "Industry",
            "Relationship",
            "Account manager",
            "Open positions",
            "Filled positions",
            "Time to fill (days)",
            "Avg candidate score",
            "Interview ratio %",
            "Offer ratio %",
            "Joining ratio %",
            "Repeat business",
          ],
          rows: data.rows.map((r) => [
            r.companyName,
            r.industry,
            titleCase(r.relationshipStatus),
            r.accountManager,
            r.openPositions,
            r.filledPositions,
            r.timeToFillDays,
            r.avgCandidateScore,
            r.interviewRatio,
            r.offerRatio,
            r.joiningRatio,
            r.repeatBusiness ? "Yes" : "No",
          ]),
        }
      : null,
  );

  if (isLoading || !data) return <LoadingBlock rows={6} />;

  return (
    <TableShell>
      <thead>
        <tr>
          <Th>Client</Th>
          <Th>Relationship</Th>
          <Th>Account manager</Th>
          <Th>Open</Th>
          <Th>Filled</Th>
          <Th>Fill days</Th>
          <Th>Avg score</Th>
          <Th>Interview %</Th>
          <Th>Offer %</Th>
          <Th>Join %</Th>
          <Th>Repeat</Th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row) => (
          <Tr key={row.clientId}>
            <Td>
              <span className="font-medium">{row.companyName}</span>
              <span className="block text-[11px] text-muted-foreground">{row.industry ?? "—"}</span>
            </Td>
            <Td>
              <Badge tone={row.relationshipStatus === "active" ? "success" : "muted"}>
                {titleCase(row.relationshipStatus)}
              </Badge>
            </Td>
            <Td className="text-muted-foreground">{row.accountManager ?? "—"}</Td>
            <Td className="num">{row.openPositions}</Td>
            <Td className="num">{row.filledPositions}</Td>
            <Td className="num">{row.timeToFillDays || "—"}</Td>
            <Td>
              <ScorePill score={row.avgCandidateScore || null} />
            </Td>
            <Td className="num">{row.interviewRatio}%</Td>
            <Td className="num">{row.offerRatio}%</Td>
            <Td className="num">{row.joiningRatio}%</Td>
            <Td>{row.repeatBusiness ? <Badge tone="primary">Yes</Badge> : <span className="text-muted-foreground">No</span>}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

/* ------------------------------------------------------- 8. Placement report */

export function PlacementsReport({ register, period = "monthly" }: ReportViewProps) {
  const { data, isLoading } = usePlacementReport(period);

  /* The export is the placement register itself — one line per placed person —
     because that is the document a client or an auditor actually asks for. */
  useRegister(
    register,
    data
      ? {
          headers: [
            "Candidate",
            "Email",
            "Position",
            "Client",
            "Department",
            "Location",
            "Placed on",
            "Start date",
            "Period",
            "Salary",
            "Match %",
            "Tech %",
            "Final %",
            "Time to hire (days)",
            "Recruiter",
            "Status",
          ],
          rows: data.detail.map((p) => [
            p.candidateName,
            p.candidateEmail ?? "",
            p.positionTitle,
            p.clientName ?? "",
            p.department ?? "",
            p.location ?? "",
            new Date(p.placedAt).toLocaleDateString(),
            p.startDate ? new Date(p.startDate).toLocaleDateString() : "",
            p.period,
            p.offeredSalaryAmount != null
              ? formatMoney(p.offeredSalaryAmount, p.salaryCurrency)
              : (p.offeredSalary ?? ""),
            p.matchScoreAtHire ?? "",
            p.techScoreAtHire ?? "",
            p.finalScore ?? "",
            p.timeToHireDays ?? "",
            p.recruiterName ?? "",
            p.status,
          ]),
        }
      : null,
  );

  if (isLoading || !data) return <LoadingBlock rows={6} />;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Offers" value={data.totals.offers} />
        <StatCard label="Accepted" value={data.totals.accepted} tone="success" />
        <StatCard label="Rejected" value={data.totals.rejected} tone="danger" />
        <StatCard label="Joined" value={data.totals.joined} tone="success" />
        <StatCard label="Dropouts" value={data.totals.dropouts} tone="warning" />
        <StatCard label="Success rate" value={`${data.totals.successPct}%`} tone="primary" />
      </div>

      <TableShell>
        <thead>
          <tr>
            <Th>{titleCase(period)} period</Th>
            <Th>Offers</Th>
            <Th>Joined</Th>
            <Th>Dropouts</Th>
            <Th>Success</Th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <Tr key={row.label}>
              <Td className="font-medium">{row.label}</Td>
              <Td className="num">{row.offers}</Td>
              <Td className="num">{row.joined}</Td>
              <Td className="num">{row.dropouts}</Td>
              <Td className="num">{row.successPct}%</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      <Grid cols={3}>
        <Panel title="By department">
          <BarList data={data.byDepartment} />
        </Panel>
        <Panel title="By client">
          <BarList data={data.byClient} />
        </Panel>
        <Panel title="By recruiter">
          <BarList data={data.byRecruiter} />
        </Panel>
      </Grid>

      <Card className="p-5">
        <SectionTitle
          title="Placement register"
          hint="Every placement in the period — who was placed, with which client, on what terms"
        />
        {data.detail.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">No placements recorded yet.</p>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Candidate</Th>
                <Th>Placed with</Th>
                <Th>Position</Th>
                <Th>Location</Th>
                <Th>Placed / starts</Th>
                <Th>Salary</Th>
                <Th>Scores</Th>
                <Th>Days to hire</Th>
                <Th>Recruiter</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.detail.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`/candidates/${p.candidateId}`} className="font-medium hover:text-primary-light">
                      {p.candidateName}
                    </Link>
                    {p.candidateEmail && (
                      <span className="block text-[11px] text-muted-foreground">{p.candidateEmail}</span>
                    )}
                  </Td>
                  <Td>
                    <span className="font-medium">{p.clientName ?? "—"}</span>
                    {p.department && (
                      <span className="block text-[11px] text-muted-foreground">{p.department}</span>
                    )}
                  </Td>
                  <Td>{p.positionTitle}</Td>
                  <Td>{p.location ?? "—"}</Td>
                  <Td className="num whitespace-nowrap">
                    {new Date(p.placedAt).toLocaleDateString()}
                    <span className="block text-[11px] text-muted-foreground">
                      {p.startDate ? `starts ${new Date(p.startDate).toLocaleDateString()}` : "start date TBC"}
                    </span>
                  </Td>
                  <Td className="num whitespace-nowrap">
                    {p.offeredSalaryAmount != null
                      ? formatMoney(p.offeredSalaryAmount, p.salaryCurrency)
                      : (p.offeredSalary ?? "—")}
                  </Td>
                  <Td className="num whitespace-nowrap">
                    {p.finalScore != null ? `${Math.round(p.finalScore)}% final` : "—"}
                    <span className="block text-[11px] text-muted-foreground">
                      {p.matchScoreAtHire != null ? `match ${Math.round(p.matchScoreAtHire)}%` : "match —"} ·{" "}
                      {p.techScoreAtHire != null ? `tech ${Math.round(p.techScoreAtHire)}%` : "tech —"}
                    </span>
                  </Td>
                  <Td className="num">{p.timeToHireDays ?? "—"}</Td>
                  <Td>{p.recruiterName ?? "—"}</Td>
                  <Td>
                    <Badge tone={p.status === "dropped" ? "danger" : "success"}>{titleCase(p.status)}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </div>
  );
}
