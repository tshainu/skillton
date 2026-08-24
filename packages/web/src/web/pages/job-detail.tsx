import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  ClipboardCheck,
  Cpu,
  ExternalLink,
  FileText,
  RefreshCw,
  Sparkles,
  Star,
  TimerOff,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, SectionTitle } from "../components/ui/card";
import { ChipList, PageHeader, StatCard } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Badge, StatusBadge } from "../components/ui/badge";
import { EmptyState, ErrorNote, LoadingBlock, Spinner } from "../components/ui/feedback";
import { ExpiredScoreNotice, ScoreRing, scoreColor } from "../components/ui/score";
import { useJob, useJobMatches, useReparseJob, useUpdateJob } from "../queries/jobs";
import { useRerunMatch, useRunMatchForJob, useToggleShortlist } from "../queries/matching";
import { openDocument, useSetCandidateStatus } from "../queries/candidates";
import { useSettings } from "../queries/insights";

export default function JobDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const job = useJob(id);
  const matches = useJobMatches(id);
  const settings = useSettings();
  const runMatch = useRunMatchForJob();
  const rerun = useRerunMatch();
  const reparse = useReparseJob();
  const update = useUpdateJob();
  const toggleShortlist = useToggleShortlist();
  const setStatus = useSetCandidateStatus();
  const [error, setError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);

  const ranked = matches.data?.ranked ?? [];
  const expired = matches.data?.expired ?? [];
  const threshold = settings.data?.values.shortlistThreshold ?? 65;

  async function run() {
    setError(null);
    setRunResult(null);
    try {
      const result = await runMatch.mutateAsync({ jdId: id, explainTop: 10, onlyMissing: false });
      const top = result.results[0]?.score;
      setRunResult(
        `Scored ${result.scored} candidates · ${result.shortlisted} above the ${threshold} threshold${
          top != null ? ` · top score ${top}` : ""
        }`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (job.isLoading) {
    return (
      <>
        <PageHeader title="Loading job…" />
        <LoadingBlock rows={5} />
      </>
    );
  }

  if (job.isError || !job.data) {
    return <EmptyState icon={FileText} title="Job not found" body="It may have been deleted." />;
  }

  const data = job.data;

  return (
    <>
      <Link
        to="/jobs"
        className="rise mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-primary-light"
      >
        <ArrowLeft className="size-3.5" /> All job descriptions
      </Link>

      <PageHeader
        eyebrow={data.client?.companyName ?? "No client"}
        title={data.title}
        subtitle={[data.department, data.location, data.salaryRange, `${data.openings} opening(s)`]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <select
              value={data.status}
              onChange={(e) =>
                update.mutate({ id, status: e.target.value as "open" | "on_hold" | "closed" | "filled" })
              }
              className="h-9 cursor-pointer rounded-md border border-border bg-[#141414] px-3 text-[13px] outline-none"
            >
              <option value="open">Open</option>
              <option value="on_hold">On hold</option>
              <option value="filled">Filled</option>
              <option value="closed">Closed</option>
            </select>
            {data.jdFilePath && (
              <Button variant="outline" onClick={() => void openDocument(data.jdFilePath!)}>
                <ExternalLink className="size-4" /> JD document
              </Button>
            )}
            <Button onClick={run} disabled={runMatch.isPending} className="glow-primary">
              {runMatch.isPending ? <Spinner /> : <Cpu className="size-4" />}
              Run matching
            </Button>
          </>
        }
      />

      {error && <ErrorNote message={error} className="mb-4" />}
      {runResult && (
        <Card className="mb-4 border-success/25 p-3.5">
          <p className="flex items-center gap-2 text-[13px] text-success">
            <Sparkles className="size-4" /> {runResult}
          </p>
        </Card>
      )}

      {!data.isParsed && (
        <Card className="mb-5 flex flex-wrap items-center gap-3 border-destructive/30 p-4">
          <TimerOff className="size-4 text-destructive" />
          <p className="flex-1 text-[13px]">
            This JD has not been parsed yet — matching needs the parsed document and its embedding.
          </p>
          <Button size="sm" variant="outline" onClick={() => reparse.mutate({ id })} disabled={reparse.isPending}>
            {reparse.isPending ? <Spinner /> : <RefreshCw className="size-3.5" />} Parse now
          </Button>
        </Card>
      )}

      <div className="rise rise-2 mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ranked candidates" value={ranked.length} icon={Cpu} tone="primary" />
        <StatCard
          label="Shortlisted"
          value={ranked.filter((r) => r.match.isShortlisted).length}
          hint={`Threshold ${threshold}`}
          icon={Star}
          tone="success"
        />
        <StatCard
          label="Expired scores"
          value={expired.length}
          hint="Hidden and excluded from ranking"
          icon={TimerOff}
          tone="warning"
        />
        <StatCard
          label="Top score"
          value={ranked[0] ? ranked[0].match.matchScore.toFixed(1) : "—"}
          hint={ranked[0] ? `${ranked[0].candidate.firstName} ${ranked[0].candidate.lastName ?? ""}` : undefined}
          icon={Sparkles}
          tone="info"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Ranked shortlist */}
        <div className="rise rise-3 min-w-0">
          <SectionTitle
            title="Top suitable candidates"
            hint="Ranked by match score. Expired scores are excluded from this ranking."
          />

          {matches.isLoading && <LoadingBlock rows={4} />}

          {!matches.isLoading && ranked.length === 0 && (
            <EmptyState
              icon={Cpu}
              title="No live matches yet"
              body="Run the matching engine to score every parsed CV in your library against this job description."
              action={
                <Button onClick={run} disabled={runMatch.isPending}>
                  {runMatch.isPending ? <Spinner /> : <Cpu className="size-4" />} Run matching
                </Button>
              }
            />
          )}

          <div className="space-y-3">
            {ranked.map((row) => (
              <Card key={row.match.id} hover className="p-4">
                <div className="flex items-start gap-4">
                  <div className="flex flex-col items-center gap-1.5">
                    <span className="num text-[10px] text-muted-foreground">#{row.rank}</span>
                    <ScoreRing score={row.match.matchScore} size={58} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link to={`/candidates/${row.candidate.id}`}>
                          <h3 className="truncate font-display text-[15px] font-semibold hover:text-primary-light">
                            {row.candidate.firstName} {row.candidate.lastName}
                          </h3>
                        </Link>
                        <p className="truncate text-[12.5px] text-muted-foreground">
                          {[
                            row.candidate.headline,
                            row.candidate.location,
                            row.candidate.experienceYears ? `${row.candidate.experienceYears} yrs` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <StatusBadge status={row.candidate.currentStatus} />
                        <button
                          type="button"
                          onClick={() =>
                            toggleShortlist.mutate({
                              matchId: row.match.id,
                              isShortlisted: !row.match.isShortlisted,
                            })
                          }
                          className={
                            row.match.isShortlisted
                              ? "grid size-7 place-items-center rounded-md border border-primary/40 bg-primary/15 text-primary"
                              : "grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                          }
                          title={row.match.isShortlisted ? "Remove from shortlist" : "Add to shortlist"}
                        >
                          <Star className={row.match.isShortlisted ? "size-3.5 fill-current" : "size-3.5"} />
                        </button>
                      </div>
                    </div>

                    {row.match.aiExplanation && (
                      <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                        {row.match.aiExplanation}
                      </p>
                    )}

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {(row.match.skillsMatched ?? []).length > 0 && (
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-success">
                            Matched
                          </p>
                          <ChipList items={row.match.skillsMatched ?? []} tone="matched" max={8} />
                        </div>
                      )}
                      {(row.match.skillsMissing ?? []).length > 0 && (
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-destructive">
                            Missing
                          </p>
                          <ChipList items={row.match.skillsMissing ?? []} tone="missing" max={8} />
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      <span className="num text-[11px] text-muted-foreground">
                        base {row.match.baseScore?.toFixed(1) ?? "—"} · expires{" "}
                        {new Date(row.match.expiresAt).toLocaleDateString()}
                      </span>
                      <div className="ml-auto flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => rerun.mutate({ candidateId: row.candidate.id, jdId: id })}
                          disabled={rerun.isPending}
                          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] transition-colors hover:border-border-hover"
                        >
                          <RefreshCw className={rerun.isPending ? "size-3 animate-spin" : "size-3"} /> Re-score
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setStatus.mutate({
                              id: row.candidate.id,
                              /* Must match what the JD-CV matrix writes, or the
                                 candidate never shows up in the screening queue.
                                 "hr_screening" is a status; the stage is "screening". */
                              status: "hr_screening",
                              stage: "screening",
                              note: `Advanced from ${data.title} shortlist`,
                            })
                          }
                          className="flex items-center gap-1 rounded-md border border-primary/35 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary-light transition-colors hover:bg-primary/15"
                        >
                          <ClipboardCheck className="size-3" /> Send to HR screening
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Expired block */}
          {expired.length > 0 && (
            <div className="mt-7">
              <SectionTitle
                title={`Expired scores (${expired.length})`}
                hint="These candidates stay in your library, but their scores are withheld and excluded from ranking and search until re-run."
              />
              <div className="space-y-2.5">
                {expired.map((row) => (
                  <Card key={row.match.id} className="p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <ScoreRing score={null} size={44} />
                      <div className="min-w-0 flex-1">
                        <Link to={`/candidates/${row.candidate.id}`}>
                          <p className="truncate text-[13.5px] font-medium text-muted-foreground line-through decoration-muted-foreground/50 hover:text-foreground">
                            {row.candidate.firstName} {row.candidate.lastName}
                          </p>
                        </Link>
                        <p className="truncate text-[11.5px] text-muted-foreground">{row.candidate.headline}</p>
                      </div>
                      <ExpiredScoreNotice
                        compact
                        expiredAt={row.match.expiresAt}
                        pending={rerun.isPending}
                        onRerun={() => rerun.mutate({ candidateId: row.candidate.id, jdId: id })}
                        className="w-full sm:w-auto"
                      />
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* JD detail sidebar */}
        <div className="rise rise-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Parsed requirements</CardTitle>
              <Badge tone={data.isParsed ? "success" : "danger"}>{data.isParsed ? "Parsed" : "Pending"}</Badge>
            </CardHeader>
            <CardContent className="space-y-4 text-[12.5px]">
              {data.parsed?.summary && (
                <p className="leading-relaxed text-muted-foreground">{data.parsed.summary}</p>
              )}
              {(data.skillsRequired ?? []).length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Required skills
                  </p>
                  <ChipList items={data.skillsRequired ?? []} max={20} />
                </div>
              )}
              <dl className="space-y-1.5">
                {data.parsed?.minExperienceYears != null && (
                  <Row label="Min experience" value={`${data.parsed.minExperienceYears} years`} />
                )}
                {data.parsed?.education && <Row label="Education" value={data.parsed.education} />}
                {data.experienceLevel && <Row label="Level" value={data.experienceLevel} />}
                {data.employmentType && <Row label="Type" value={data.employmentType.replace("_", " ")} />}
              </dl>
              {(data.parsed?.responsibilities ?? []).length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Responsibilities
                  </p>
                  <ul className="space-y-1 text-muted-foreground">
                    {(data.parsed?.responsibilities ?? []).slice(0, 6).map((r) => (
                      <li key={r} className="flex gap-2">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                        <span className="leading-snug">{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Score bands</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: "85 – 100 · exceptional", from: 85 },
                { label: "70 – 84 · strong", from: 70 },
                { label: "55 – 69 · possible", from: 55 },
                { label: "below 55 · weak", from: 0 },
              ].map((band, i, arr) => {
                const upper = i === 0 ? 101 : arr[i - 1]!.from;
                const count = ranked.filter(
                  (r) => r.match.matchScore >= band.from && r.match.matchScore < upper,
                ).length;
                return (
                  <div key={band.label} className="flex items-center gap-2.5">
                    <span className="size-2 rounded-full" style={{ background: scoreColor(band.from + 5) }} />
                    <span className="flex-1 text-[12px] text-muted-foreground">{band.label}</span>
                    <span className="num text-[12.5px] font-semibold">{count}</span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium capitalize">{value}</dd>
    </div>
  );
}
