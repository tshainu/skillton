import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  Ban,
  Cpu,
  ExternalLink,
  Mail,
  MapPin,
  Mic,
  Phone,
  RefreshCw,
  RotateCcw,
  Sparkles,
  TimerOff,
  Trophy,
  User,
} from "lucide-react";
import { titleCase } from "../lib/labels";
import { Card, CardContent, CardHeader, CardTitle, SectionTitle } from "../components/ui/card";
import { ChipList, PageHeader } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Badge, StatusBadge } from "../components/ui/badge";
import { EmptyState, ErrorNote, LoadingBlock, Spinner } from "../components/ui/feedback";
import { ExpiredScoreNotice, Meter, ScorePill, ScoreRing } from "../components/ui/score";
import { Field, Input, Select, Textarea } from "../components/ui/field";
import { Modal, Tabs } from "../components/ui/modal";
import {
  openDocument,
  useBlacklistCandidate,
  useCandidate,
  useCandidateMatches,
  useMarkHired,
  useParseCandidate,
  useRestoreCandidate,
} from "../queries/candidates";
import { useRerunMatch, useRunMatchForCandidate } from "../queries/matching";
import { useFinalReport, useInviteAiInterview } from "../queries/interviews";
import { useSettings } from "../queries/insights";
import { CURRENCIES, formatMoney, parseAmountInput } from "../lib/currency";

type Tab = "overview" | "matches" | "interviews" | "timeline";

export default function CandidateDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const candidate = useCandidate(id);
  const matches = useCandidateMatches(id);
  const settings = useSettings();
  const rerun = useRerunMatch();
  const runAll = useRunMatchForCandidate();
  const parse = useParseCandidate();
  const blacklist = useBlacklistCandidate();
  const restore = useRestoreCandidate();
  const invite = useInviteAiInterview();
  const markHired = useMarkHired();

  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);
  const [hireOpen, setHireOpen] = useState(false);
  const [blOpen, setBlOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [hireForm, setHireForm] = useState({
    jdId: "",
    salaryCurrency: "LKR",
    offeredSalary: "",
    startDate: "",
    notes: "",
  });
  const [blReason, setBlReason] = useState("");

  const report = useFinalReport(id);

  if (candidate.isLoading) {
    return (
      <>
        <PageHeader title="Loading candidate…" />
        <LoadingBlock rows={5} />
      </>
    );
  }

  if (candidate.isError || !candidate.data) {
    return <EmptyState icon={User} title="Candidate not found" body="It may have been deleted by retention cleanup." />;
  }

  const { candidate: c, events, hrInterviews, aiInterviews, techInterviews, placement } = candidate.data;
  const liveMatches = (matches.data ?? []).filter((m) => !m.expired);
  const expiredMatches = (matches.data ?? []).filter((m) => m.expired);
  const best = liveMatches[0] ?? null;
  const latestTech = techInterviews[0] ?? null;
  const latestAi = aiInterviews.find((a) => a.status === "completed") ?? aiInterviews[0] ?? null;

  async function hire() {
    setError(null);
    try {
      await markHired.mutateAsync({
        id,
        jdId: hireForm.jdId || best?.job.id || undefined,
        salaryCurrency: hireForm.salaryCurrency,
        offeredSalaryAmount: parseAmountInput(hireForm.offeredSalary) ?? undefined,
        startDate: hireForm.startDate || undefined,
        notes: hireForm.notes || undefined,
      });
      setHireOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <Link
        to="/candidates"
        className="rise mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-primary-light"
      >
        <ArrowLeft className="size-3.5" /> Candidate library
      </Link>

      <PageHeader
        eyebrow={titleCase(c.currentStage)}
        title={`${c.firstName} ${c.lastName ?? ""}`.trim()}
        subtitle={c.headline ?? undefined}
        actions={
          <>
            {c.cvFilePath && (
              <Button variant="outline" onClick={() => void openDocument(c.cvFilePath!)}>
                <ExternalLink className="size-4" /> Original CV
              </Button>
            )}
            {c.parseStatus !== "parsed" && (
              <Button variant="outline" onClick={() => parse.mutate({ id })} disabled={parse.isPending}>
                {parse.isPending ? <Spinner /> : <Sparkles className="size-4" />} Parse CV
              </Button>
            )}
            <Button onClick={() => runAll.mutate({ candidateId: id })} disabled={runAll.isPending}>
              {runAll.isPending ? <Spinner /> : <Cpu className="size-4" />} Match to all open roles
            </Button>
          </>
        }
      />

      {error && <ErrorNote message={error} className="mb-4" />}

      {/* Identity strip */}
      <Card className="rise rise-2 mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-primary/15 font-display text-[17px] font-bold text-primary-light">
            {c.firstName.charAt(0)}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <StatusBadge status={c.currentStatus} />
              {(c.tags ?? []).map((tag) => (
                <Badge key={tag} tone="muted">
                  {tag}
                </Badge>
              ))}
            </div>
            <p className="num mt-1 text-[11px] text-muted-foreground">
              Added {new Date(c.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-muted-foreground">
          {c.email && (
            <span className="flex items-center gap-1.5">
              <Mail className="size-3.5" /> {c.email}
            </span>
          )}
          {c.phone && (
            <span className="flex items-center gap-1.5">
              <Phone className="size-3.5" /> {c.phone}
            </span>
          )}
          {c.location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3.5" /> {c.location}
            </span>
          )}
          {c.experienceYears != null && <span className="num">{c.experienceYears} years experience</span>}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {c.currentStatus === "blacklisted" ? (
            <Button size="sm" variant="outline" onClick={() => restore.mutate({ id })} disabled={restore.isPending}>
              {restore.isPending ? <Spinner /> : <RotateCcw className="size-3.5" />} Restore
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setBlOpen(true)}>
              <Ban className="size-3.5" /> Blacklist
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const result = await invite.mutateAsync({ candidateId: id, jdId: best?.job.id, validDays: 7 });
              setInviteLink(`${window.location.origin}${result.link}`);
            }}
            disabled={invite.isPending}
          >
            {invite.isPending ? <Spinner /> : <Mic className="size-3.5" />} AI interview invite
          </Button>
          {!placement && (
            <Button size="sm" onClick={() => setHireOpen(true)}>
              <Trophy className="size-3.5" /> Mark hired
            </Button>
          )}
        </div>
      </Card>

      {inviteLink && (
        <Card className="mb-5 flex flex-wrap items-center gap-3 border-primary/25 p-3.5">
          <Mic className="size-4 text-primary" />
          <p className="min-w-0 flex-1 truncate text-[12.5px]">
            Interview link: <span className="num text-primary-light">{inviteLink}</span>
          </p>
          <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(inviteLink)}>
            Copy
          </Button>
          <a
            href={inviteLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] transition-colors hover:border-border-hover"
          >
            Open <ExternalLink className="size-3" />
          </a>
        </Card>
      )}

      {placement && (
        <Card className="mb-5 border-success/25 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <Trophy className="size-5 text-success" />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-success">
                Placed as {placement.positionTitle}
                {placement.clientName ? ` at ${placement.clientName}` : ""}
              </p>
              <p className="num text-[12px] text-muted-foreground">
                {placement.offeredSalary ?? "salary not recorded"} · placed{" "}
                {new Date(placement.placedAt).toLocaleDateString()} · {placement.timeToHireDays ?? "?"} days to hire
              </p>
            </div>
            <Link
              to="/placed"
              className="inline-flex h-8 items-center rounded-md border border-success/35 bg-success/10 px-3 text-[12.5px] font-medium text-success"
            >
              Placed register
            </Link>
          </div>
        </Card>
      )}

      <Tabs
        className="rise rise-2 mb-4 w-fit"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "matches", label: "Job matches", count: matches.data?.length ?? 0 },
          {
            value: "interviews",
            label: "Interviews",
            count: hrInterviews.length + aiInterviews.length + techInterviews.length,
          },
          { value: "timeline", label: "Timeline", count: events.length },
        ]}
      />

      {tab === "overview" && (
        <div className="rise rise-3 grid gap-4 lg:grid-cols-[1fr_330px]">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Parsed profile</CardTitle>
                <Badge tone={c.parseStatus === "parsed" ? "success" : "danger"}>{c.parseStatus}</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {c.parseError && <ErrorNote message={c.parseError} />}
                <Block label="Skills" items={c.skillsExtracted ?? []} />
                <Block label="Technologies" items={c.technologies ?? []} />
                <Block label="Education" items={c.education ?? []} />
                <Block label="Certifications" items={c.certifications ?? []} />
                <Block label="Languages" items={c.languages ?? []} />
                <Block label="Projects" items={c.projects ?? []} />
              </CardContent>
            </Card>

            {c.cvText && (
              <Card>
                <CardHeader>
                  <CardTitle>Extracted CV text</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-black/40 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
                    {c.cvText}
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Final report card */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Final score</CardTitle>
                <Badge tone="muted">
                  match ×{settings.data?.values.matchWeight ?? 0.2} + tech ×{settings.data?.values.techWeight ?? 0.8}
                </Badge>
              </CardHeader>
              <CardContent className="pt-1">
                {report.isLoading && <Spinner />}
                {report.data && (
                  <>
                    <div className="flex items-center gap-4">
                      <ScoreRing score={report.data.finalScore} size={78} label="final" />
                      <div className="min-w-0 space-y-2 text-[12.5px]">
                        <div className="flex items-center gap-2">
                          <span className="w-16 text-muted-foreground">Match</span>
                          <ScorePill score={report.data.match?.score ?? null} />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-16 text-muted-foreground">Technical</span>
                          <ScorePill score={report.data.tech?.totalScore ?? null} />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-16 text-muted-foreground">AI</span>
                          <Badge tone="info">qualitative</Badge>
                        </div>
                      </div>
                    </div>
                    <p className="mt-4 rounded-lg border border-border bg-white/[0.02] p-3 text-[12.5px] leading-relaxed">
                      {report.data.recommendation}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            {latestAi?.aiSummary && (
              <Card>
                <CardHeader>
                  <CardTitle>AI interview read</CardTitle>
                  <Badge tone="info">qualitative</Badge>
                </CardHeader>
                <CardContent className="space-y-3 text-[12.5px]">
                  <p className="leading-relaxed text-muted-foreground">{latestAi.aiSummary}</p>
                  {(latestAi.suggestedTechFocus ?? []).length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                        Probe in the technical round
                      </p>
                      <ChipList items={latestAi.suggestedTechFocus ?? []} max={8} />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {latestTech && (
              <Card>
                <CardHeader>
                  <CardTitle>Technical evaluation</CardTitle>
                  <StatusBadge status={latestTech.recommendation} />
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12.5px] text-muted-foreground">Weighted total</span>
                    <span className="num font-display text-[22px] font-bold">{latestTech.totalScore}</span>
                  </div>
                  {Object.entries(latestTech.sectionScores ?? {}).map(([section, params]) => {
                    const values = Object.values(params);
                    const avg = values.reduce((s, v) => s + v, 0) / (values.length || 1);
                    return (
                      <div key={section}>
                        <div className="mb-1 flex items-baseline justify-between gap-2">
                          <span className="text-[12px]">{section}</span>
                          <span className="num text-[11px] text-muted-foreground">{avg.toFixed(1)}/10</span>
                        </div>
                        <Meter value={avg} max={10} />
                      </div>
                    );
                  })}
                  {latestTech.comments && (
                    <p className="text-[12px] leading-relaxed text-muted-foreground">{latestTech.comments}</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "matches" && (
        <div className="rise rise-3 space-y-3">
          <SectionTitle
            title="Best matching job descriptions"
            hint="Candidate view — every JD this CV has been scored against."
          />
          {matches.isLoading && <LoadingBlock rows={3} />}
          {!matches.isLoading && (matches.data ?? []).length === 0 && (
            <EmptyState
              icon={Cpu}
              title="Not matched yet"
              body="Run the matching engine to score this candidate against every open role."
              action={
                <Button onClick={() => runAll.mutate({ candidateId: id })} disabled={runAll.isPending}>
                  {runAll.isPending ? <Spinner /> : <Cpu className="size-4" />} Match to all open roles
                </Button>
              }
            />
          )}
          {liveMatches.map((m) => (
            <Card key={m.matchId} hover className="p-4">
              <div className="flex items-start gap-4">
                <ScoreRing score={m.score} size={56} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link to={`/jobs/${m.job.id}`}>
                        <p className="truncate font-display text-[14.5px] font-semibold hover:text-primary-light">
                          {m.job.title}
                        </p>
                      </Link>
                      <p className="truncate text-[12px] text-muted-foreground">
                        {[m.job.clientName, m.job.location].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {m.isShortlisted && <Badge tone="primary">shortlisted</Badge>}
                      <StatusBadge status={m.job.status} />
                      <span className="num text-[11px] text-muted-foreground">{m.daysLeft}d left</span>
                    </div>
                  </div>
                  {m.aiExplanation && (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{m.aiExplanation}</p>
                  )}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {(m.skillsMatched ?? []).length > 0 && (
                      <ChipList items={m.skillsMatched ?? []} tone="matched" max={7} />
                    )}
                    {(m.skillsMissing ?? []).length > 0 && (
                      <ChipList items={m.skillsMissing ?? []} tone="missing" max={7} />
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}

          {expiredMatches.length > 0 && (
            <>
              <SectionTitle
                className="pt-4"
                title={`Expired (${expiredMatches.length})`}
                hint="Scores are withheld and excluded from ranking and search until you re-run the match."
              />
              {expiredMatches.map((m) => (
                <Card key={m.matchId} className="p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <TimerOff className="size-4 text-warning" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-muted-foreground line-through decoration-muted-foreground/50">
                        {m.job.title}
                      </p>
                      <p className="num truncate text-[11px] text-muted-foreground">
                        matched {new Date(m.matchedAt).toLocaleDateString()} · expired{" "}
                        {new Date(m.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <ExpiredScoreNotice
                      compact
                      pending={rerun.isPending}
                      onRerun={() => rerun.mutate({ candidateId: id, jdId: m.job.id })}
                    />
                  </div>
                </Card>
              ))}
            </>
          )}
        </div>
      )}

      {tab === "interviews" && (
        <div className="rise rise-3 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>HR screening</CardTitle>
              <Badge tone="muted">{hrInterviews.length}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {hrInterviews.length === 0 && (
                <p className="text-[13px] text-muted-foreground">Not screened yet.</p>
              )}
              {hrInterviews.map((hr) => (
                <div key={hr.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={hr.result} />
                    <span className="num text-[11.5px] text-muted-foreground">
                      {new Date(hr.conductedAt).toLocaleDateString()}
                    </span>
                    {hr.communicationScore != null && (
                      <Badge tone="info">communication {hr.communicationScore}/10</Badge>
                    )}
                    {hr.salaryExpectation && <Badge tone="muted">{hr.salaryExpectation}</Badge>}
                    {hr.noticePeriod && <Badge tone="muted">notice: {hr.noticePeriod}</Badge>}
                  </div>
                  {hr.overallNotes && (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{hr.overallNotes}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI voice interviews</CardTitle>
              <Badge tone="info">qualitative only</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {aiInterviews.length === 0 && <p className="text-[13px] text-muted-foreground">No invites yet.</p>}
              {aiInterviews.map((ai) => (
                <div key={ai.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={ai.status} />
                    <span className="num text-[11.5px] text-muted-foreground">
                      invited {new Date(ai.invitedAt).toLocaleDateString()}
                    </span>
                    {ai.durationSeconds != null && (
                      <Badge tone="muted">{Math.round(ai.durationSeconds / 60)} min</Badge>
                    )}
                    <Link
                      to={`/ai-interviews?id=${ai.id}`}
                      className="ml-auto text-[12px] text-primary-light hover:underline"
                    >
                      Open report
                    </Link>
                  </div>
                  {ai.aiSummary && (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{ai.aiSummary}</p>
                  )}
                  {(ai.weaknesses ?? []).length > 0 && (
                    <div className="mt-2">
                      <ChipList items={ai.weaknesses ?? []} tone="missing" max={6} />
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Technical interviews</CardTitle>
              <Badge tone="primary">80% of final score</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {techInterviews.length === 0 && (
                <p className="text-[13px] text-muted-foreground">Not evaluated yet.</p>
              )}
              {techInterviews.map((t) => (
                <div key={t.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num font-display text-[18px] font-bold">{t.totalScore}</span>
                    <StatusBadge status={t.recommendation} />
                    <span className="num text-[11.5px] text-muted-foreground">
                      {new Date(t.conductedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {t.comments && (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{t.comments}</p>
                  )}
                  {t.selectionReason && (
                    <p className="mt-1.5 text-[12px] italic text-muted-foreground/80">{t.selectionReason}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "timeline" && (
        <Card className="rise rise-3">
          <CardContent className="pt-5">
            {events.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">No events recorded.</p>
            ) : (
              <ol className="relative space-y-4 pl-5">
                <span className="absolute left-[3px] top-1.5 h-[calc(100%-12px)] w-px bg-border" />
                {events.map((event) => (
                  <li key={event.id} className="relative">
                    <span className="absolute -left-5 top-1.5 size-[7px] rounded-full bg-primary" />
                    <div className="flex flex-wrap items-baseline gap-2">
                      <p className="text-[13px] font-medium">{event.title}</p>
                      <Badge tone="muted">{titleCase(event.kind)}</Badge>
                      {event.actorName && (
                        <span className="text-[11px] text-muted-foreground">{event.actorName}</span>
                      )}
                      <span className="num ml-auto text-[11px] text-muted-foreground/70">
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {event.detail && (
                      <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{event.detail}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      {/* Mark hired */}
      <Modal
        open={hireOpen}
        onClose={() => setHireOpen(false)}
        title="Mark as hired"
        description="This creates a permanent placement record — it survives retention cleanup so the Placed register stays complete."
        footer={
          <>
            <Button variant="ghost" onClick={() => setHireOpen(false)}>
              Cancel
            </Button>
            <Button onClick={hire} disabled={markHired.isPending}>
              {markHired.isPending && <Spinner />} Create placement
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <Field label="Role placed into">
            <Select value={hireForm.jdId} onChange={(e) => setHireForm({ ...hireForm, jdId: e.target.value })}>
              <option value="">{best ? `${best.job.title} (best match)` : "Select a role"}</option>
              {(matches.data ?? []).map((m) => (
                <option key={m.job.id} value={m.job.id}>
                  {m.job.title}
                  {m.job.clientName ? ` — ${m.job.clientName}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field
              label="Offered salary"
              hint={
                parseAmountInput(hireForm.offeredSalary) != null
                  ? formatMoney(parseAmountInput(hireForm.offeredSalary), hireForm.salaryCurrency, "month")
                  : "Monthly gross."
              }
            >
              <div className="flex gap-2">
                <Select
                  value={hireForm.salaryCurrency}
                  onChange={(e) => setHireForm({ ...hireForm, salaryCurrency: e.target.value })}
                  className="num w-[92px] shrink-0"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
                <Input
                  className="num"
                  inputMode="decimal"
                  value={hireForm.offeredSalary}
                  onChange={(e) => setHireForm({ ...hireForm, offeredSalary: e.target.value })}
                  placeholder="780,000.00"
                />
              </div>
            </Field>
            <Field label="Start date">
              <Input
                type="date"
                value={hireForm.startDate}
                onChange={(e) => setHireForm({ ...hireForm, startDate: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea
              value={hireForm.notes}
              onChange={(e) => setHireForm({ ...hireForm, notes: e.target.value })}
              placeholder="Offer accepted same day. Client rated shortlist quality 5/5."
            />
          </Field>
        </div>
      </Modal>

      {/* Blacklist */}
      <Modal
        open={blOpen}
        onClose={() => setBlOpen(false)}
        title="Blacklist candidate"
        description="The candidate stays in the database with a red tag. An admin can restore them later."
        footer={
          <>
            <Button variant="ghost" onClick={() => setBlOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await blacklist.mutateAsync({ id, reason: blReason || "Not specified" });
                setBlOpen(false);
              }}
              disabled={blacklist.isPending}
            >
              {blacklist.isPending && <Spinner />} Blacklist
            </Button>
          </>
        }
      >
        <Field label="Reason">
          <Select value={blReason} onChange={(e) => setBlReason(e.target.value)}>
            <option value="">Select a reason</option>
            {(settings.data?.blacklistReasons ?? []).map((r) => (
              <option key={r.id} value={r.label}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      </Modal>
    </>
  );
}

function Block({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <ChipList items={items} max={30} />
    </div>
  );
}
