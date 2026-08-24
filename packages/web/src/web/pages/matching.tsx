import { useState } from "react";
import { Link } from "wouter";
import { Cpu, Search, Sparkles, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { PageHeader, StatCard, TableShell, Td, Th, Tr } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { StatusBadge } from "../components/ui/badge";
import { Field, Input, Select } from "../components/ui/field";
import { EmptyState, ErrorNote, LoadingBlock, Spinner } from "../components/ui/feedback";
import { Meter, ScorePill } from "../components/ui/score";
import { Tabs } from "../components/ui/modal";
import { useJobs } from "../queries/jobs";
import {
  useExpiryOverview,
  useMatchSearch,
  useRunMatchForJob,
} from "../queries/matching";
import { useSettings, useUpdateSettings } from "../queries/insights";

type Tab = "run" | "search";

export default function MatchingPage() {
  const [tab, setTab] = useState<Tab>("run");
  const jobs = useJobs("open");
  const overview = useExpiryOverview();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const runJob = useRunMatchForJob();

  const [jdId, setJdId] = useState("");
  const [explainTop, setExplainTop] = useState(10);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ scored: number; shortlisted: number; top?: number } | null>(null);

  const [skill, setSkill] = useState("");
  /* Starts at 0 on purpose: defaulting to 60 hid every match in a library whose
     scores all sit in the 30s and 40s, so a skill search looked broken. */
  const [minScore, setMinScore] = useState(0);
  const [searchJd, setSearchJd] = useState("");
  const search = useMatchSearch({ skill, minScore, jdId: searchJd, enabled: tab === "search" });

  const threshold = settings.data?.values.shortlistThreshold ?? 65;

  async function run() {
    setError(null);
    setResult(null);
    if (!jdId) return setError("Pick a job description first");
    try {
      const res = await runJob.mutateAsync({ jdId, explainTop, onlyMissing });
      setResult({ scored: res.scored, shortlisted: res.shortlisted, top: res.results[0]?.score });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Matching engine"
        subtitle="Semantic similarity between the JD document and each CV, plus skill, experience, education and location bonuses — with the reasoning attached to every score."
      />

      {overview.isLoading && <LoadingBlock rows={2} />}

      {overview.data && (
        <div className="rise rise-2 mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard label="Total match records" value={overview.data.total} icon={Cpu} tone="info" />
          <StatCard
            label="Live scores"
            value={overview.data.live}
            hint={`Threshold ${overview.data.threshold}`}
            icon={TrendingUp}
            tone="success"
          />
          <StatCard
            label="Shortlisted"
            value={overview.data.shortlisted}
            hint="At or above the threshold"
            icon={Sparkles}
            tone="primary"
          />
        </div>
      )}

      <Tabs
        className="rise rise-2 mb-4 w-fit"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "run", label: "Run a match" },
          { value: "search", label: "Search matches" },
        ]}
      />

      {tab === "run" && (
        <div className="rise rise-3 grid gap-4 lg:grid-cols-[1fr_340px]">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Score a job description against the CV library</CardTitle>
                <p className="text-[12px] text-muted-foreground">
                  Only parsed CVs are eligible. AI explanations are generated for the top scorers.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <ErrorNote message={error} />}
              <Field label="Job description">
                <Select value={jdId} onChange={(e) => setJdId(e.target.value)}>
                  <option value="">Select an open role…</option>
                  {(jobs.data ?? []).map((j) => (
                    <option key={j.id} value={j.id} disabled={!j.isParsed}>
                      {j.title}
                      {j.clientName ? ` — ${j.clientName}` : ""}
                      {j.isParsed ? "" : " (JD not parsed)"}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="AI explanations for top N" hint="Higher N costs more time.">
                  <Input
                    type="number"
                    min={0}
                    max={30}
                    value={explainTop}
                    onChange={(e) => setExplainTop(Number(e.target.value))}
                  />
                </Field>
                <Field label="Scope" hint="Skip candidates already scored for this role.">
                  <Select
                    value={onlyMissing ? "missing" : "all"}
                    onChange={(e) => setOnlyMissing(e.target.value === "missing")}
                  >
                    <option value="all">Re-score every candidate</option>
                    <option value="missing">Only unscored candidates</option>
                  </Select>
                </Field>
              </div>

              <Button onClick={run} disabled={runJob.isPending} className="glow-primary w-full" size="lg">
                {runJob.isPending ? <Spinner /> : <Cpu className="size-4" />}
                {runJob.isPending ? "Scoring the library…" : "Run matching engine"}
              </Button>

              {result && (
                <div className="rounded-lg border border-success/25 bg-success/[0.07] p-3.5">
                  <p className="flex items-center gap-2 text-[13px] text-success">
                    <Sparkles className="size-4" />
                    Scored {result.scored} candidates · {result.shortlisted} above threshold {threshold}
                    {result.top != null ? ` · top ${result.top}` : ""}
                  </p>
                  {jdId && (
                    <Link
                      to={`/jobs/${jdId}`}
                      className="mt-2 inline-block text-[12.5px] text-primary-light hover:underline"
                    >
                      Open the ranked shortlist →
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Scoring formula</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-[12.5px]">
                {[
                  { label: "Semantic similarity (JD ↔ CV)", weight: 75 },
                  { label: "Skill coverage", weight: 15 },
                  { label: "Experience fit", weight: 5 },
                  { label: "Education", weight: 5 },
                  { label: "Location", weight: 5 },
                ].map((part) => (
                  <div key={part.label}>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span>{part.label}</span>
                      <span className="num text-[11px] text-muted-foreground">max {part.weight}</span>
                    </div>
                    <Meter value={part.weight} max={75} color="#ff6b2b" />
                  </div>
                ))}
                <p className="border-t border-border pt-3 text-[12px] leading-relaxed text-muted-foreground">
                  Total is capped at 100. The AI voice interview never contributes to this number — final candidate
                  score is match × 0.20 + technical × 0.80.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Thresholds</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3.5">
                <Field label="Shortlist threshold" hint="Candidates at or above this score are auto-shortlisted.">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={threshold}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (value !== threshold) updateSettings.mutate({ shortlistThreshold: value });
                    }}
                  />
                </Field>
                {updateSettings.isPending && <Spinner className="text-primary" />}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === "search" && (
        <div className="rise rise-3 space-y-4">
          <Card className="flex flex-wrap items-end gap-3 p-3.5">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
                placeholder="Skills — comma-separated, e.g. Cisco, Juniper"
                className="pl-9"
              />
            </div>
            <div className="w-[150px]">
              <Input
                type="number"
                min={0}
                max={100}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                placeholder="Min score"
              />
            </div>
            <Select value={searchJd} onChange={(e) => setSearchJd(e.target.value)} className="w-[240px]">
              <option value="">All job descriptions</option>
              {(jobs.data ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </Select>
            {search.isFetching && <Spinner className="text-muted-foreground" />}
          </Card>

          <p className="text-[12px] text-muted-foreground">
            Only live scores are searchable. Anything awaiting a re-match is handled in Operations.
          </p>

          {search.isLoading && <LoadingBlock rows={5} />}
          {search.data?.length === 0 && (
            <EmptyState icon={Search} title="No live matches" body="Loosen the filters, or re-run aged-out scores from Operations." />
          )}
          {(search.data?.length ?? 0) > 0 && (
            <TableShell>
              <thead>
                <tr>
                  <Th>Candidate</Th>
                  <Th>Job description</Th>
                  <Th className="w-24">Score</Th>
                  <Th className="w-28">Exp</Th>
                  <Th className="w-44">Stage</Th>
                </tr>
              </thead>
              <tbody>
                {(search.data ?? []).map((row) => (
                  <Tr key={row.matchId}>
                    <Td>
                      <Link to={`/candidates/${row.candidateId}`} className="font-medium hover:text-primary-light">
                        {row.candidateName}
                      </Link>
                      {row.headline && (
                        <p className="max-w-[280px] truncate text-[11.5px] text-muted-foreground">{row.headline}</p>
                      )}
                    </Td>
                    <Td className="text-muted-foreground">{row.jobTitle}</Td>
                    <Td>
                      <ScorePill score={row.score} />
                    </Td>
                    <Td className="num">{row.experienceYears != null ? `${row.experienceYears}y` : "—"}</Td>
                    <Td>
                      <StatusBadge status={row.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </div>
      )}
    </>
  );
}
