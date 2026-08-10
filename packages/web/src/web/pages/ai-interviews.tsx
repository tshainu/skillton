import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "wouter";
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  CalendarClock,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  LayoutGrid,
  ListChecks,
  Mail,
  Mic,
  RefreshCw,
  Table2,
  Send,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, SectionTitle } from "../components/ui/card";
import { ChipList, PageHeader, StatCard } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Badge, StatusBadge } from "../components/ui/badge";
import { EmptyState, LoadingBlock, Spinner } from "../components/ui/feedback";
import { Meter } from "../components/ui/score";
import { Modal, Tabs } from "../components/ui/modal";
import {
  useAiInterview,
  useAiInterviewQueue,
  useAiInterviews,
  useAiInterviewResults,
  useInviteAiInterview,
  useRegradeAiInterview,
  useRescheduleAiInterview,
} from "../queries/interviews";
import { QuestionSetPicker } from "../components/interviews/question-set-picker";
import { InviteSchedule, defaultSend, defaultSlot } from "../components/interviews/invite-schedule";
import { ScorePill } from "../components/ui/score";
import { Input } from "../components/ui/field";
import { RecordingPlayer } from "../components/interviews/recording-player";
import { DateRangeFilter, useDateRange } from "../components/ui/date-range-filter";

type Tab = "queue" | "all" | "results";

export default function AiInterviewsPage() {
  const [params] = useSearchParams();
  const queue = useAiInterviewQueue();
  const all = useAiInterviews();
  const invite = useInviteAiInterview();
  const regrade = useRegradeAiInterview();
  const reschedule = useRescheduleAiInterview();
  const results = useAiInterviewResults();

  const [tab, setTab] = useState<Tab>("queue");
  /* One date window per tab — each list has its own meaningful date column. */
  const queueDates = useDateRange();
  const resultDates = useDateRange();
  const allDates = useDateRange();
  const [openId, setOpenId] = useState<string | null>(params.get("id"));
  const [link, setLink] = useState<string | null>(null);
  /* When that link stops working — the first thing a candidate asks. */
  const [linkExpiry, setLinkExpiry] = useState<Date | null>(null);
  /* Outcome of the invitation email, shown next to the link. */
  const [mailNote, setMailNote] = useState<{ ok: boolean; text: string } | null>(null);
  /* Invite and reschedule both need a question set chosen before they fire. */
  const [inviteFor, setInviteFor] = useState<{ id: string; name: string; email: string | null } | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<{
    id: string;
    name: string;
    email: string | null;
    completed: boolean;
  } | null>(null);
  const [chosenSet, setChosenSet] = useState<string | null>(null);
  const [validDays, setValidDays] = useState(7);
  /* The address the invitation goes to — prefilled from the candidate record and
     editable, because a stale CV email is the most common reason it bounces. */
  const [toEmail, setToEmail] = useState("");
  const [sendMail, setSendMail] = useState(true);
  /* The slot the interview is booked for, and when the invitation itself goes
     out — a recruiter booking Thursday 10am rarely wants the mail landing now. */
  const [slotAt, setSlotAt] = useState(defaultSlot);
  const [sendWhen, setSendWhen] = useState<"now" | "later">("now");
  const [sendAt, setSendAt] = useState(defaultSend);
  /* Recruiters print or paste reports into client documents, so every report has a
     plain tabular rendering next to the visual one. */
  const [reportView, setReportView] = useState<"report" | "table">("report");

  /* Date-filtered views of each list. */
  const queueRows = useMemo(
    () => (queue.data ?? []).filter((row) => queueDates.inRange(row.updatedAt)),
    [queue.data, queueDates],
  );
  const resultRows = useMemo(
    () => (results.data ?? []).filter((row) => resultDates.inRange(row.conductedAt)),
    [results.data, resultDates],
  );
  const allRows = useMemo(
    () => (all.data ?? []).filter((row) => allDates.inRange(row.interview.conductedAt ?? row.interview.invitedAt)),
    [all.data, allDates],
  );
  const detail = useAiInterview(openId ?? "");

  /* Every invite/re-schedule starts from a fresh slot suggestion rather than
     whatever the last one happened to leave behind. */
  useEffect(() => {
    if (!inviteFor && !rescheduleFor) return;
    setSlotAt(defaultSlot());
    setSendWhen("now");
    setSendAt(defaultSend());
  }, [inviteFor, rescheduleFor]);

  useEffect(() => {
    const id = params.get("id");
    if (id) {
      setOpenId(id);
      setTab("all");
    }
  }, [params]);

  const completed = useMemo(() => (all.data ?? []).filter((r) => r.interview.status === "completed"), [all.data]);
  const pending = useMemo(
    () => (all.data ?? []).filter((r) => ["pending", "invited", "in_progress"].includes(r.interview.status)),
    [all.data],
  );

  return (
    <>
      <PageHeader
        eyebrow="Interviews"
        title="AI voice interview"
        subtitle="A real-time voice screener that produces a qualitative read — communication, ownership, depth and the exact topics your technical panel should probe. It never contributes a number to the candidate ranking."
      />

      <div className="rise rise-2 mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Awaiting invite" value={queue.data?.length ?? 0} icon={Send} tone="primary" />
        <StatCard label="Invited / in progress" value={pending.length} icon={Mic} tone="info" />
        <StatCard label="Completed" value={completed.length} icon={Sparkles} tone="success" />
        <StatCard
          label="Avg duration"
          value={
            completed.length
              ? `${Math.round(
                  completed.reduce((s, r) => s + (r.interview.durationSeconds ?? 0), 0) / completed.length / 60,
                )}m`
              : "—"
          }
          tone="warning"
        />
      </div>

      <Tabs
        className="rise rise-2 mb-4 w-fit"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "queue", label: "Invite queue", count: queue.data?.length },
          { value: "all", label: "Interviews", count: all.data?.length },
          { value: "results", label: "Results", count: results.data?.length },
        ]}
      />

      {link && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 border-primary/25 p-3.5">
          <Mic className="size-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px]">
              Share this link with the candidate: <span className="num text-primary-light">{link}</span>
            </p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {linkExpiry
                ? `Valid until ${linkExpiry.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} — after that the candidate needs a re-schedule. It also stops working once the interview is submitted.`
                : "Single-use: it stops working once the interview is submitted."}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(link)}>
            <Copy className="size-3.5" /> Copy
          </Button>
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] transition-colors hover:border-border-hover"
          >
            Preview room <ExternalLink className="size-3" />
          </a>
        </Card>
      )}

      {mailNote && (
        <Card
          className={`mb-4 flex items-start gap-2.5 p-3.5 ${
            mailNote.ok ? "border-success/30" : "border-warning/30"
          }`}
        >
          <Mail className={`mt-0.5 size-4 shrink-0 ${mailNote.ok ? "text-success" : "text-warning"}`} />
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{mailNote.text}</p>
        </Card>
      )}

      {tab === "queue" && (
        <div className="rise rise-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <DateRangeFilter range={queueDates.range} onChange={queueDates.setRange} label="Queued" />
            {queueDates.active && (
              <span className="num text-[11.5px] text-muted-foreground">
                {queueRows.length} of {(queue.data ?? []).length}
              </span>
            )}
          </div>
          {queue.isLoading && <LoadingBlock rows={3} />}
          {!queue.isLoading && queueRows.length === 0 && (
            <EmptyState
              icon={Mic}
              title="Nobody waiting for an invite"
              body="Candidates cleared by HR screening appear here automatically."
              action={
                <Link
                  to="/screening"
                  className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                >
                  Go to HR screening
                </Link>
              }
            />
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {queueRows.map((c) => (
              <Card key={c.id} hover className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <Link to={`/candidates/${c.id}`}>
                    <p className="truncate font-display text-[14.5px] font-semibold hover:text-primary-light">
                      {c.firstName} {c.lastName}
                    </p>
                  </Link>
                  <p className="truncate text-[12px] text-muted-foreground">{c.headline ?? c.email}</p>
                </div>
                <StatusBadge status={c.currentStatus} />
                <Button
                  size="sm"
                  onClick={() => {
                    setChosenSet(null);
                    setValidDays(7);
                    setSendMail(true);
                    setToEmail(c.email ?? "");
                    setInviteFor({
                      id: c.id,
                      name: `${c.firstName} ${c.lastName ?? ""}`.trim(),
                      email: c.email ?? null,
                    });
                  }}
                >
                  <Send className="size-3.5" /> Send invite
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}

      {tab === "results" && (
        <div className="rise rise-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <DateRangeFilter range={resultDates.range} onChange={resultDates.setRange} label="Conducted" />
            {resultDates.active && (
              <span className="num text-[11.5px] text-muted-foreground">
                {resultRows.length} of {(results.data ?? []).length}
              </span>
            )}
          </div>
          {results.isLoading && <LoadingBlock rows={4} />}
          {!results.isLoading && resultRows.length === 0 && (
            <EmptyState
              icon={Sparkles}
              title="No completed interviews yet"
              body="Once a candidate finishes their AI interview the score and summary appear here, with a direct route into the technical round."
            />
          )}
          <div className="space-y-3">
            {resultRows.map((row) => {
              const summary = row.aiSummary ?? "";
              const terminated = summary.startsWith("INTERVIEW TERMINATED");
              const flags = row.fraudFlags ?? [];
              return (
                <Card key={row.id} hover className="p-0">
                  <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-stretch">
                    {/* Identity + score rail */}
                    <div className="flex shrink-0 flex-col items-start gap-2 sm:w-[210px]">
                      <Link to={`/candidates/${row.candidateId}`}>
                        <p className="font-display text-[15px] font-semibold leading-tight hover:text-primary-light">
                          {row.candidateName}
                        </p>
                      </Link>
                      <p className="text-[12px] text-muted-foreground">{row.jobTitle ?? "No role attached"}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <ScorePill score={row.score} />
                        <span className="text-[10px] leading-tight text-muted-foreground">
                          Qualitative
                          <br />
                          only
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge tone="muted">
                          <Clock className="size-3" />
                          {row.durationSeconds ? `${Math.round(row.durationSeconds / 60)} min` : "—"}
                        </Badge>
                        {row.conductedAt && (
                          <Badge tone="muted">{new Date(row.conductedAt).toLocaleDateString()}</Badge>
                        )}
                      </div>
                    </div>

                    {/* Summary + evidence */}
                    <div className="min-w-0 flex-1 space-y-3 border-border/60 sm:border-l sm:pl-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {terminated && (
                          <Badge tone="danger">
                            <ShieldAlert className="size-3" /> Terminated early
                          </Badge>
                        )}
                        {row.readyForTechnical && <Badge tone="success">Ready for technical</Badge>}
                        {flags.map((f) => (
                          <Badge key={f} tone="warning">
                            {f.replace(/_/g, " ")}
                          </Badge>
                        ))}
                        {row.focusLossCount > 0 && (
                          <Badge tone="warning">left screen ×{row.focusLossCount}</Badge>
                        )}
                      </div>

                      <p className="line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground">
                        {summary || "No summary was produced for this interview."}
                      </p>

                      {row.assessment && (
                        <div className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                          {Object.entries(row.assessment).map(([key, value]) => (
                            <div key={key}>
                              <div className="mb-0.5 flex items-baseline justify-between gap-2">
                                <span className="text-[11px] capitalize text-muted-foreground">
                                  {key.replace(/([A-Z])/g, " $1")}
                                </span>
                                <span className="num text-[10.5px] text-muted-foreground">{value}/10</span>
                              </div>
                              <Meter value={value as number} max={10} />
                            </div>
                          ))}
                        </div>
                      )}

                      {(row.suggestedTechFocus ?? []).length > 0 && (
                        <div>
                          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                            Probe in the technical round
                          </p>
                          <ChipList items={row.suggestedTechFocus ?? []} max={4} />
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 flex-col gap-2 sm:w-[150px]">
                      <Button size="sm" onClick={() => setOpenId(row.id)}>
                        <Eye className="size-3.5" /> Full report
                      </Button>
                      <Link to={`/tech-interviews?candidate=${row.candidateId}`}>
                        <Button
                          size="sm"
                          variant={row.readyForTechnical ? "default" : "outline"}
                          className="w-full"
                        >
                          Technical
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setChosenSet(null);
                          setValidDays(7);
                          setSendMail(true);
                          setToEmail(row.candidateEmail ?? "");
                          setRescheduleFor({
                            id: row.id,
                            name: row.candidateName,
                            email: row.candidateEmail ?? null,
                            completed: true,
                          });
                        }}
                      >
                        <CalendarClock className="size-3.5" /> Re-schedule
                      </Button>
                      <Link to={`/candidates/${row.candidateId}`}>
                        <Button size="sm" variant="ghost" className="w-full">
                          Profile
                        </Button>
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {tab === "all" && (
        <div className="rise rise-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DateRangeFilter range={allDates.range} onChange={allDates.setRange} label="Interview date" />
            {allDates.active && (
              <span className="num text-[11.5px] text-muted-foreground">
                {allRows.length} of {(all.data ?? []).length}
              </span>
            )}
          </div>
          {all.isLoading && <LoadingBlock rows={4} />}
          {!all.isLoading && allRows.length === 0 && (
            <EmptyState icon={Mic} title="No interviews yet" body="Invite a candidate from the queue." />
          )}
          {allRows.map((row) => (
            <Card key={row.interview.id} hover className="p-4">
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/candidates/${row.interview.candidateId}`}>
                      <p className="font-display text-[15px] font-semibold hover:text-primary-light">
                        {row.candidateName}
                      </p>
                    </Link>
                    <StatusBadge status={row.interview.status} />
                    {row.jobTitle && <Badge tone="muted">{row.jobTitle}</Badge>}
                    {row.interview.durationSeconds != null && (
                      <Badge tone="info">{Math.round(row.interview.durationSeconds / 60)} min</Badge>
                    )}
                  </div>
                  {row.interview.aiSummary && (
                    <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
                      {row.interview.aiSummary}
                    </p>
                  )}
                  <p className="num mt-2 text-[11px] text-muted-foreground/70">
                    invited {new Date(row.interview.invitedAt).toLocaleDateString()}
                    {row.interview.conductedAt
                      ? ` · conducted ${new Date(row.interview.conductedAt).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <Button size="sm" variant="outline" onClick={() => setOpenId(row.interview.id)}>
                    <Eye className="size-3.5" /> View report
                  </Button>
                  {/* Re-scheduling stays available after completion — a recruiter often
                      needs a re-sit; the previous sitting is archived, not lost. */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setChosenSet(null);
                      setValidDays(7);
                      setSendMail(true);
                      setToEmail(row.candidateEmail ?? "");
                      setRescheduleFor({
                        id: row.interview.id,
                        name: row.candidateName,
                        email: row.candidateEmail ?? null,
                        completed: row.interview.status === "completed",
                      });
                    }}
                  >
                    <CalendarClock className="size-3.5" /> Re-schedule
                  </Button>
                  {row.interview.status !== "completed" && (
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          `${window.location.origin}/interview/${row.interview.token}`,
                        )
                      }
                      className="rounded-md border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-border-hover hover:text-foreground"
                    >
                      Copy link
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Send invite — pick the question set that will drive the interview */}
      <Modal
        open={Boolean(inviteFor)}
        onClose={() => setInviteFor(null)}
        title={`Send AI interview invite${inviteFor ? ` — ${inviteFor.name}` : ""}`}
        description="Pick the question set the AI interviewer must work through. It is loaded into the interviewer the moment the candidate joins."
        width="max-w-2xl"
        footer={
          <>
            <div className="mr-auto flex items-center gap-2">
              <span className="text-[12px] text-muted-foreground">Link valid for</span>
              <Input
                type="number"
                min={1}
                max={90}
                className="h-8 w-16"
                value={validDays}
                onChange={(e) => setValidDays(Number(e.target.value))}
              />
              <span className="text-[12px] text-muted-foreground">days</span>
            </div>
            <Button variant="outline" onClick={() => setInviteFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={!chosenSet || invite.isPending || (sendMail && !toEmail.trim())}
              onClick={async () => {
                if (!inviteFor || !chosenSet) return;
                const result = await invite.mutateAsync({
                  candidateId: inviteFor.id,
                  questionSetId: chosenSet,
                  validDays,
                  sendEmail: sendMail,
                  email: sendMail && toEmail.trim() ? toEmail.trim() : undefined,
                  scheduledAt: slotAt ? new Date(slotAt).toISOString() : undefined,
                  sendAt: sendWhen === "later" && sendAt ? new Date(sendAt).toISOString() : undefined,
                });
                setLink(`${window.location.origin}${result.link}`);
                setLinkExpiry(result.expiresAt ? new Date(result.expiresAt) : null);
                setMailNote(
                  result.emailQueuedFor
                    ? {
                        ok: true,
                        text: `Invitation queued for ${new Date(result.emailQueuedFor).toLocaleString()} — it will be emailed to ${result.emailTo} automatically.`,
                      }
                    : result.emailSent
                      ? { ok: true, text: `Invitation emailed to ${result.emailTo}.` }
                      : sendMail
                        ? { ok: false, text: `Email not sent — ${result.emailError}` }
                        : null,
                );
                setInviteFor(null);
              }}
            >
              {invite.isPending ? <Spinner /> : <Send className="size-3.5" />}{" "}
              {sendMail ? "Send invitation" : "Create link"}
            </Button>
          </>
        }
      >
        <div className="mb-4 space-y-3 rounded-xl border border-border bg-white/[0.02] p-3.5">
          <div className="flex items-start gap-2.5">
            <Mail className="mt-2 size-4 shrink-0 text-primary" />
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Candidate email
              </span>
              <Input
                type="email"
                value={toEmail}
                placeholder="name@example.com"
                onChange={(e) => setToEmail(e.target.value)}
              />
            </label>
          </div>
          {!inviteFor?.email && (
            <p className="text-[12px] text-warning">
              No email address is on this candidate's record — type one to email the invitation.
            </p>
          )}
        </div>

        <InviteSchedule
          slotAt={slotAt}
          onSlotAt={setSlotAt}
          sendWhen={sendWhen}
          onSendWhen={setSendWhen}
          sendAt={sendAt}
          onSendAt={setSendAt}
          validDays={validDays}
          sendMail={sendMail}
          onSendMail={setSendMail}
        />

        <QuestionSetPicker value={chosenSet} onChange={setChosenSet} />
        {!chosenSet && (
          <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <ListChecks className="size-3.5" /> Select a question set to enable the invitation.
          </p>
        )}
      </Modal>

      {/* Re-schedule — fresh link, optionally a different question set */}
      <Modal
        open={Boolean(rescheduleFor)}
        onClose={() => setRescheduleFor(null)}
        title={`Re-schedule interview${rescheduleFor ? ` — ${rescheduleFor.name}` : ""}`}
        description="Issues a new candidate link and invalidates the old one. The previous sitting is archived on the report, so nothing is lost. Leave the set unchanged to keep the current one."
        width="max-w-2xl"
        footer={
          <>
            <div className="mr-auto flex items-center gap-2">
              <span className="text-[12px] text-muted-foreground">New link valid for</span>
              <Input
                type="number"
                min={1}
                max={90}
                className="h-8 w-16"
                value={validDays}
                onChange={(e) => setValidDays(Number(e.target.value))}
              />
              <span className="text-[12px] text-muted-foreground">days</span>
            </div>
            <Button variant="outline" onClick={() => setRescheduleFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={reschedule.isPending || (sendMail && !toEmail.trim())}
              onClick={async () => {
                if (!rescheduleFor) return;
                const result = await reschedule.mutateAsync({
                  id: rescheduleFor.id,
                  questionSetId: chosenSet ?? undefined,
                  validDays,
                  sendEmail: sendMail,
                  email: sendMail && toEmail.trim() ? toEmail.trim() : undefined,
                  scheduledAt: slotAt ? new Date(slotAt).toISOString() : undefined,
                  sendAt: sendWhen === "later" && sendAt ? new Date(sendAt).toISOString() : undefined,
                });
                setLink(`${window.location.origin}${result.link}`);
                setLinkExpiry(result.expiresAt ? new Date(result.expiresAt) : null);
                setMailNote(
                  result.emailQueuedFor
                    ? {
                        ok: true,
                        text: `New link queued for ${new Date(result.emailQueuedFor).toLocaleString()} — it will be emailed to ${result.emailTo} automatically.`,
                      }
                    : result.emailSent
                      ? { ok: true, text: `New link emailed to ${result.emailTo}.` }
                      : sendMail
                        ? { ok: false, text: `Email not sent — ${result.emailError}` }
                        : null,
                );
                setRescheduleFor(null);
              }}
            >
              {reschedule.isPending ? <Spinner /> : <CalendarClock className="size-3.5" />} Re-schedule
            </Button>
          </>
        }
      >
        {rescheduleFor?.completed && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-[12.5px] leading-relaxed">
              This interview is already completed. Re-scheduling archives the existing report, transcript and
              recording under "Previous attempts" and starts a fresh sitting.
            </p>
          </div>
        )}

        <div className="mb-4 space-y-3 rounded-xl border border-border bg-white/[0.02] p-3.5">
          <div className="flex items-start gap-2.5">
            <Mail className="mt-2 size-4 shrink-0 text-primary" />
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Candidate email
              </span>
              <Input
                type="email"
                value={toEmail}
                placeholder="name@example.com"
                onChange={(e) => setToEmail(e.target.value)}
              />
            </label>
          </div>
        </div>

        <InviteSchedule
          rescheduling
          slotAt={slotAt}
          onSlotAt={setSlotAt}
          sendWhen={sendWhen}
          onSendWhen={setSendWhen}
          sendAt={sendAt}
          onSendAt={setSendAt}
          validDays={validDays}
          sendMail={sendMail}
          onSendMail={setSendMail}
        />

        <QuestionSetPicker value={chosenSet} onChange={setChosenSet} />
      </Modal>

      {/* Report */}
      <Modal
        open={Boolean(openId)}
        onClose={() => setOpenId(null)}
        title={detail.data?.candidate ? `${detail.data.candidate.firstName} ${detail.data.candidate.lastName ?? ""}` : "AI interview report"}
        description={
          detail.data?.job
            ? `${detail.data.job.title} · qualitative assessment only`
            : "Qualitative assessment only — never part of the ranking"
        }
        width="max-w-3xl"
        footer={
          openId ? (
            <>
              <Button
                variant="outline"
                onClick={() => regrade.mutate({ id: openId })}
                disabled={regrade.isPending || detail.data?.interview.status !== "completed"}
              >
                {regrade.isPending ? <Spinner /> : <RefreshCw className="size-3.5" />} Re-grade transcript
              </Button>
              <Button onClick={() => setOpenId(null)}>Close</Button>
            </>
          ) : undefined
        }
      >
        {detail.isLoading && <LoadingBlock rows={4} />}
        {detail.data && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.data.interview.status} />
              {detail.data.interview.consentGiven && <Badge tone="success">consent recorded</Badge>}
              {detail.data.interview.identityVerified && <Badge tone="success">identity verified</Badge>}
              {detail.data.interview.durationSeconds != null && (
                <Badge tone="muted">{Math.round(detail.data.interview.durationSeconds / 60)} min</Badge>
              )}
              {/* Table view exists so the whole assessment can be printed or pasted
                  into a client document without charts getting in the way. */}
              <div className="ml-auto flex items-center gap-1 rounded-md border border-border p-0.5">
                {(
                  [
                    { value: "report", label: "Report", icon: LayoutGrid },
                    { value: "table", label: "Table", icon: Table2 },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setReportView(opt.value)}
                    className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[11.5px] transition-colors ${
                      reportView === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <opt.icon className="size-3.5" /> {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Evidence — the candidate's camera and microphone, recorded in one file. */}
            {detail.data.interview.videoUrl && (
              <RecordingPlayer
                storageKey={detail.data.interview.videoUrl}
                label="Interview evidence (video + audio)"
                hint="Captured with the candidate's consent for audit and dispute handling."
              />
            )}

            {(detail.data.interview.previousAttempts ?? []).length > 0 && (
              <div>
                <SectionTitle title="Previous attempts" className="mb-2" />
                <div className="space-y-2">
                  {(detail.data.interview.previousAttempts ?? []).map((a, i) => (
                    <Card key={i} className="p-3">
                      <div className="flex flex-wrap items-center gap-2 text-[12px]">
                        <Badge tone="muted">attempt {i + 1}</Badge>
                        <span className="num text-muted-foreground">
                          {a.conductedAt ? new Date(a.conductedAt).toLocaleString() : "not attended"}
                        </span>
                        {a.durationSeconds != null && (
                          <Badge tone="muted">{Math.round(a.durationSeconds / 60)} min</Badge>
                        )}
                        {(a.fraudFlags ?? []).map((f) => (
                          <Badge key={f} tone="warning">
                            {f.replace(/_/g, " ")}
                          </Badge>
                        ))}
                      </div>
                      {a.aiSummary && (
                        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{a.aiSummary}</p>
                      )}
                      {a.videoUrl && (
                        <div className="mt-2">
                          <RecordingPlayer storageKey={a.videoUrl} label={`Attempt ${i + 1} recording`} />
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {reportView === "table" && <AiReportTable data={detail.data} />}

            {reportView === "report" && detail.data.interview.assessment && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart
                      outerRadius="72%"
                      data={Object.entries(detail.data.interview.assessment).map(([key, value]) => ({
                        dimension: key.replace(/([A-Z])/g, " $1").replace(/^./, (m) => m.toUpperCase()),
                        score: value,
                      }))}
                    >
                      <PolarGrid stroke="#242424" />
                      <PolarAngleAxis dataKey="dimension" tick={{ fill: "#8f8f8f", fontSize: 9 }} />
                      <Radar dataKey="score" stroke="#ff6b2b" fill="#ff6b2b" fillOpacity={0.28} name="/10" />
                      <Tooltip
                        contentStyle={{
                          background: "#141414",
                          border: "1px solid #2b2b2b",
                          borderRadius: 10,
                          fontSize: 12,
                        }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2.5">
                  {Object.entries(detail.data.interview.assessment).map(([key, value]) => (
                    <div key={key}>
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <span className="text-[12px] capitalize">{key.replace(/([A-Z])/g, " $1")}</span>
                        <span className="num text-[11px] text-muted-foreground">{value}/10</span>
                      </div>
                      <Meter value={value} max={10} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {reportView === "report" && detail.data.interview.aiSummary && (
              <div>
                <SectionTitle title="Summary" className="mb-1.5" />
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {detail.data.interview.aiSummary}
                </p>
              </div>
            )}

            {reportView === "report" && (
            <div className="grid gap-4 sm:grid-cols-2">
              {(detail.data.interview.strengths ?? []).length > 0 && (
                <Card className="p-3.5">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-success">Strengths</p>
                  <ul className="space-y-1.5 text-[12.5px] text-muted-foreground">
                    {(detail.data.interview.strengths ?? []).map((s) => (
                      <li key={s} className="flex gap-2">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-success" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {(detail.data.interview.weaknesses ?? []).length > 0 && (
                <Card className="p-3.5">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-destructive">
                    Areas of concern
                  </p>
                  <ul className="space-y-1.5 text-[12.5px] text-muted-foreground">
                    {(detail.data.interview.weaknesses ?? []).map((s) => (
                      <li key={s} className="flex gap-2">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-destructive" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
            )}

            {reportView === "report" && (detail.data.interview.suggestedTechFocus ?? []).length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  Probe in the technical round
                </p>
                <ChipList items={detail.data.interview.suggestedTechFocus ?? []} max={10} />
              </div>
            )}

            {reportView === "report" && (detail.data.interview.topicCoverage ?? []).length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Topic coverage
                </p>
                {(detail.data.interview.topicCoverage ?? []).map((t) => (
                  <div key={t.topic}>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="text-[12px]">{t.topic}</span>
                      <span className="num text-[11px] text-muted-foreground">{t.coverage}%</span>
                    </div>
                    <Meter value={t.coverage} />
                  </div>
                ))}
              </div>
            )}

            {reportView === "report" && (detail.data.interview.transcript ?? []).length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Transcript
                </p>
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border bg-black/30 p-3">
                  {(detail.data.interview.transcript ?? []).map((turn, i) => (
                    <div key={i} className="text-[12.5px]">
                      <span
                        className={
                          turn.role === "ai"
                            ? "num mr-2 text-[10px] uppercase tracking-wider text-primary"
                            : "num mr-2 text-[10px] uppercase tracking-wider text-info"
                        }
                      >
                        {turn.role === "ai" ? "interviewer" : "candidate"}
                      </span>
                      <span className="leading-relaxed text-muted-foreground">{turn.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.data.interview.status !== "completed" && (
              <Card className="border-primary/25 p-3.5">
                <p className="text-[12.5px]">
                  Candidate link:{" "}
                  <span className="num text-primary-light">
                    {window.location.origin}/interview/{detail.data.interview.token}
                  </span>
                </p>
              </Card>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

type AiInterviewDetail = NonNullable<ReturnType<typeof useAiInterview>["data"]>;

/**
 * Plain tabular rendering of an AI interview report. Same data as the visual
 * report, arranged so it survives printing and pasting into a client document.
 */
function AiReportTable({ data }: { data: AiInterviewDetail }) {
  const iv = data.interview;
  const facts: [string, string][] = [
    ["Candidate", `${data.candidate?.firstName ?? ""} ${data.candidate?.lastName ?? ""}`.trim() || "—"],
    ["Email", data.candidate?.email ?? "—"],
    ["Position", data.job?.title ?? "—"],
    ["Status", iv.status.replace(/_/g, " ")],
    ["Invited", new Date(iv.invitedAt).toLocaleString()],
    ["Conducted", iv.conductedAt ? new Date(iv.conductedAt).toLocaleString() : "—"],
    ["Duration", iv.durationSeconds != null ? `${Math.round(iv.durationSeconds / 60)} min` : "—"],
    ["Consent recorded", iv.consentGiven ? "Yes" : "No"],
    ["Identity verified", iv.identityVerified ? "Yes" : "No"],
    ["Left screen", `${iv.focusLossCount} time(s)`],
    ["Time away", `${iv.awaySeconds}s`],
    ["Time penalty", `${iv.timePenaltySeconds ?? 0}s`],
    ["Integrity flags", (iv.fraudFlags ?? []).map((f) => f.replace(/_/g, " ")).join(", ") || "none"],
    ["Recording", iv.videoUrl ? "Stored (video + audio)" : "Not captured"],
    ["Summary", iv.aiSummary ?? "—"],
    ["Strengths", (iv.strengths ?? []).join("; ") || "—"],
    ["Areas of concern", (iv.weaknesses ?? []).join("; ") || "—"],
    ["Probe in technical", (iv.suggestedTechFocus ?? []).join("; ") || "—"],
    ["Selection reasoning", iv.selectionReason ?? "—"],
  ];

  return (
    <div className="space-y-5">
      <TableBlock
        title="Interview record"
        headers={["Field", "Value"]}
        rows={facts.map(([k, v]) => [k, v])}
      />
      {iv.assessment && (
        <TableBlock
          title="Assessment"
          headers={["Dimension", "Score / 10"]}
          rows={Object.entries(iv.assessment).map(([k, v]) => [
            k.replace(/([A-Z])/g, " $1").replace(/^./, (m) => m.toUpperCase()),
            String(v),
          ])}
        />
      )}
      {(iv.topicCoverage ?? []).length > 0 && (
        <TableBlock
          title="Topic coverage"
          headers={["Topic", "Coverage"]}
          rows={(iv.topicCoverage ?? []).map((t) => [t.topic, `${t.coverage}%`])}
        />
      )}
      {(iv.transcript ?? []).length > 0 && (
        <TableBlock
          title="Transcript"
          headers={["#", "Speaker", "Words"]}
          rows={(iv.transcript ?? []).map((turn, i) => [
            String(i + 1),
            turn.role === "ai" ? "Interviewer" : "Candidate",
            turn.text,
          ])}
        />
      )}
    </div>
  );
}

function TableBlock({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <div>
      <SectionTitle title={title} className="mb-2" />
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead>
            <tr className="bg-surface-2">
              {headers.map((h) => (
                <th
                  key={h}
                  className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="align-top odd:bg-black/20">
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={`border-b border-border/60 px-3 py-2 leading-relaxed ${
                      j === 0 ? "whitespace-nowrap text-muted-foreground" : "text-foreground"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
