import { useMemo, useState } from "react";
import { Link } from "wouter";
import { CheckSquare, ClipboardCheck, Mic, Pencil, Plus, Settings2, TimerOff, Trash2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, SectionTitle } from "../components/ui/card";
import { PageHeader, StatCard } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Badge, StatusBadge } from "../components/ui/badge";
import { Field, Input, Select, Textarea } from "../components/ui/field";
import { EmptyState, ErrorNote, LoadingBlock, Spinner } from "../components/ui/feedback";
import { Modal, Tabs } from "../components/ui/modal";
import { FormSection, MoneyInput, RadioGroup, RatingSlider, YesNo } from "../components/ui/inputs";
import { formatMoney, parseAmountInput } from "../lib/currency";
import { ScorePill } from "../components/ui/score";
import {
  useHrQuestions,
  useRemoveHrQuestion,
  useSaveHrQuestion,
  useScreeningHistory,
  useMarkForAiInterview,
  useScreeningQueue,
  useSubmitScreening,
} from "../queries/interviews";
import { useSetBucketBulk } from "../queries/talent";
import { BUCKET_CLASS, isBucket, RED_REASONS, titleCase, YELLOW_REASONS } from "../lib/labels";
import { cn } from "../lib/utils";
import { useMe } from "../queries/session";
import { useSettings } from "../queries/insights";

type Tab = "queue" | "history" | "form";

export default function ScreeningPage() {
  const queue = useScreeningQueue();
  const questions = useHrQuestions();
  const history = useScreeningHistory();
  const submit = useSubmitScreening();
  const saveQuestion = useSaveHrQuestion();
  const removeQuestion = useRemoveHrQuestion();
  const me = useMe();
  const settings = useSettings();
  const defaultCurrency = settings.data?.defaultCurrency ?? "LKR";
  const isAdmin = me.data && "user" in me.data && ["super_admin", "agency_admin"].includes(me.data.user.role);

  const [tab, setTab] = useState<Tab>("queue");
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    communicationScore: 7,
    salaryCurrency: "LKR",
    salaryAmount: "",
    noticePeriod: "",
    willingToRelocate: "",
    overallNotes: "",
    result: "selected" as "selected" | "hold" | "rejected",
  });

  const [qOpen, setQOpen] = useState(false);
  const [qForm, setQForm] = useState({ id: "", label: "", fieldType: "text", options: "", sortOrder: 0 });

  /* Bulk selection -> AI interview, and bulk bucket assignment. */
  const markForAi = useMarkForAiInterview();
  const setBucketBulk = useSetBucketBulk();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bucketOpen, setBucketOpen] = useState(false);
  const [bucketForm, setBucketForm] = useState({ bucket: "green", reason: "" });

  function toggleChecked(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const candidate = useMemo(() => (queue.data ?? []).find((c) => c.id === active) ?? null, [queue.data, active]);

  function open(id: string) {
    setActive(id);
    setAnswers({});
    setError(null);
    setForm({
      communicationScore: 7,
      salaryCurrency: defaultCurrency,
      salaryAmount: "",
      noticePeriod: "",
      willingToRelocate: "",
      overallNotes: "",
      result: "selected",
    });
  }

  async function save() {
    if (!candidate) return;
    setError(null);
    try {
      const amount = parseAmountInput(form.salaryAmount);
      await submit.mutateAsync({
        candidateId: candidate.id,
        jdId: candidate.jdId ?? undefined,
        communicationScore: form.communicationScore,
        salaryExpectation: amount != null ? formatMoney(amount, form.salaryCurrency, "month") : undefined,
        noticePeriod: form.noticePeriod || undefined,
        willingToRelocate: form.willingToRelocate ? form.willingToRelocate === "yes" : undefined,
        answers,
        overallNotes: form.overallNotes || undefined,
        result: form.result,
      });
      setActive(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const rows = queue.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Interviews"
        title="HR screening"
        subtitle="Shortlisted candidates are screened against your configurable question set. Selected candidates move straight into the AI interview queue; holds get a yellow tag and rejections a red one."
        actions={
          isAdmin ? (
            <Button variant="outline" onClick={() => setTab("form")}>
              <Settings2 className="size-4" /> Configure questions
            </Button>
          ) : undefined
        }
      />

      <div className="rise rise-2 mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="In queue" value={rows.length} icon={Users} tone="primary" />
        <StatCard
          label="With live score"
          value={rows.filter((r) => r.score != null).length}
          icon={ClipboardCheck}
          tone="success"
        />
        <StatCard
          label="Expired scores"
          value={rows.filter((r) => r.scoreExpired).length}
          hint="Re-run the match to rank them again"
          icon={TimerOff}
          tone="warning"
        />
        <StatCard label="Screened so far" value={history.data?.length ?? 0} icon={ClipboardCheck} tone="info" />
      </div>

      <Tabs
        className="rise rise-2 mb-4 w-fit"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "queue", label: "Screening queue", count: rows.length },
          { value: "history", label: "History", count: history.data?.length },
          { value: "form", label: "Question set", count: questions.data?.length },
        ]}
      />

      {tab === "queue" && (
        <div className="rise rise-3">
          {queue.isLoading && <LoadingBlock rows={4} />}
          {!queue.isLoading && rows.length === 0 && (
            <EmptyState
              icon={ClipboardCheck}
              title="Nobody waiting"
              body="Shortlist candidates from a job description to fill this queue."
              action={
                <Link
                  to="/jobs"
                  className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                >
                  Open job descriptions
                </Link>
              }
            />
          )}
          {rows.length > 0 && (
            <Card className="mb-3 flex flex-wrap items-center gap-3 p-3">
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={checked.size === rows.length && rows.length > 0}
                  onChange={() =>
                    setChecked(checked.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))
                  }
                  className="size-3.5 accent-[#ff6b2b]"
                />
                Select all
              </label>
              <span className="num text-[12px] text-muted-foreground">{checked.size} selected</span>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={checked.size === 0}
                  onClick={() => {
                    setBucketForm({ bucket: "green", reason: "" });
                    setBucketOpen(true);
                  }}
                >
                  <CheckSquare className="size-3.5" /> Set bucket
                </Button>
                <Button
                  size="sm"
                  disabled={checked.size === 0 || markForAi.isPending}
                  onClick={() =>
                    markForAi.mutate(
                      { candidateIds: [...checked], validDays: 7 },
                      { onSuccess: () => setChecked(new Set()) },
                    )
                  }
                >
                  {markForAi.isPending ? <Spinner /> : <Mic className="size-3.5" />}
                  Mark {checked.size || ""} for AI interview
                </Button>
              </div>
            </Card>
          )}

          {markForAi.isSuccess && (
            <p className="mb-3 text-[12px] text-success">
              {markForAi.data.selected} candidate(s) marked for the AI interview — {markForAi.data.invited} new
              invite(s) created. They now appear on the AI Interview page.
            </p>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            {rows.map((row) => (
              <Card key={row.id} hover className={cn("p-4", checked.has(row.id) && "ring-1 ring-primary/40")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <input
                      type="checkbox"
                      checked={checked.has(row.id)}
                      onChange={() => toggleChecked(row.id)}
                      className="mt-1 size-3.5 shrink-0 accent-[#ff6b2b]"
                    />
                  <div className="min-w-0">
                    <Link to={`/candidates/${row.id}`}>
                      <h3 className="truncate font-display text-[15px] font-semibold hover:text-primary-light">
                        {row.firstName} {row.lastName}
                      </h3>
                    </Link>
                    <p className="truncate text-[12.5px] text-muted-foreground">{row.headline}</p>
                    <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground/80">
                      {row.jobTitle ? `for ${row.jobTitle}` : "no role attached"}
                      {row.experienceYears != null ? ` · ${row.experienceYears} yrs` : ""}
                    </p>
                    <p className="num mt-0.5 truncate text-[11px] text-muted-foreground/70">
                      {[row.nic, row.phone].filter(Boolean).join(" · ")}
                    </p>
                    {isBucket(row.bucket) && (
                      <span
                        className={cn(
                          "mt-1.5 inline-block rounded border px-1.5 py-0.5 text-[10px]",
                          BUCKET_CLASS[row.bucket],
                        )}
                        title={row.bucketReason ?? undefined}
                      >
                        {titleCase(row.bucket)}
                      </span>
                    )}
                  </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <StatusBadge status={row.currentStatus} />
                    {row.scoreExpired ? (
                      <Badge tone="warning">
                        <TimerOff className="size-3" /> score expired
                      </Badge>
                    ) : (
                      <ScorePill score={row.score} />
                    )}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                  {row.email && <span className="truncate text-[11.5px] text-muted-foreground">{row.email}</span>}
                  <Button size="sm" className="ml-auto" onClick={() => open(row.id)}>
                    <ClipboardCheck className="size-3.5" /> Screen
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="rise rise-3 space-y-3">
          {history.isLoading && <LoadingBlock rows={4} />}
          {history.data?.length === 0 && (
            <EmptyState icon={ClipboardCheck} title="No screenings recorded yet" />
          )}
          {(history.data ?? []).map((hr) => (
            <Card key={hr.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={hr.result} />
                <span className="num text-[11.5px] text-muted-foreground">
                  {new Date(hr.conductedAt).toLocaleString()}
                </span>
                {hr.communicationScore != null && <Badge tone="info">comms {hr.communicationScore}/10</Badge>}
                {hr.salaryExpectation && <Badge tone="muted">{hr.salaryExpectation}</Badge>}
                {hr.noticePeriod && <Badge tone="muted">notice {hr.noticePeriod}</Badge>}
                <Link
                  to={`/candidates/${hr.candidateId}`}
                  className="ml-auto text-[12px] text-primary-light hover:underline"
                >
                  Open candidate
                </Link>
              </div>
              {hr.overallNotes && (
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{hr.overallNotes}</p>
              )}
            </Card>
          ))}
        </div>
      )}

      {tab === "form" && (
        <div className="rise rise-3">
          <SectionTitle
            title="Screening question set"
            hint="Answers are captured on every screening and stored against the candidate."
            right={
              isAdmin ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setQForm({ id: "", label: "", fieldType: "text", options: "", sortOrder: 0 });
                    setQOpen(true);
                  }}
                >
                  <Plus className="size-3.5" /> Add question
                </Button>
              ) : undefined
            }
          />
          {questions.isLoading && <LoadingBlock rows={4} />}
          <div className="space-y-2">
            {(questions.data ?? []).map((q) => (
              <Card key={q.id} className="flex items-center gap-3 p-3.5">
                <span className="num w-6 text-[11px] text-muted-foreground">{q.sortOrder}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px]">{q.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {q.fieldType}
                    {(q.options ?? []).length > 0 ? ` · ${(q.options ?? []).join(", ")}` : ""}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      title="Edit question"
                      onClick={() => {
                        setQForm({
                          id: q.id,
                          label: q.label,
                          fieldType: q.fieldType,
                          options: (q.options ?? []).join(", "),
                          sortOrder: q.sortOrder,
                        });
                        setQOpen(true);
                      }}
                      className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Remove question"
                      onClick={() => removeQuestion.mutate({ id: q.id })}
                      className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Screening form */}
      <Modal
        open={Boolean(candidate)}
        onClose={() => setActive(null)}
        title={candidate ? `Screen ${candidate.firstName} ${candidate.lastName ?? ""}` : ""}
        description={candidate?.jobTitle ? `For ${candidate.jobTitle}` : "No role attached"}
        width="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setActive(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={submit.isPending}>
              {submit.isPending && <Spinner />} Save screening
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <ErrorNote message={error} />}

          <FormSection
            title="Communication & fit"
            hint="Drag to rate what you heard on the call. 1 is unusable, 10 is client-ready."
          >
            <Field label="Communication clarity">
              <RatingSlider
                value={form.communicationScore}
                onChange={(v) => setForm({ ...form, communicationScore: v })}
              />
            </Field>
          </FormSection>

          <FormSection title="Compensation & availability">
            <Field label="Expected salary" hint="Stored and displayed in this currency everywhere.">
              <MoneyInput
                currency={form.salaryCurrency}
                amount={form.salaryAmount}
                onCurrencyChange={(code) => setForm({ ...form, salaryCurrency: code })}
                onAmountChange={(value) => setForm({ ...form, salaryAmount: value })}
              />
            </Field>
            <Field label="Notice period">
              <RadioGroup
                name="notice"
                columns={3}
                value={form.noticePeriod}
                onChange={(v) => setForm({ ...form, noticePeriod: v })}
                options={[
                  { value: "Immediate", label: "Immediate" },
                  { value: "2 weeks", label: "2 weeks" },
                  { value: "1 month", label: "1 month" },
                  { value: "2 months", label: "2 months" },
                  { value: "3 months", label: "3 months" },
                  { value: "Negotiable", label: "Negotiable" },
                ]}
              />
            </Field>
            <Field label="Willing to relocate">
              <YesNo
                name="relocate"
                value={form.willingToRelocate}
                onChange={(v) => setForm({ ...form, willingToRelocate: v })}
              />
            </Field>
          </FormSection>

          {(questions.data ?? []).length > 0 && (
            <FormSection
              title="Screening questions"
              hint="Your configurable question set. Answers are stored against the candidate."
            >
              {(questions.data ?? []).map((q) => (
                <Field key={q.id} label={q.label}>
                  {q.fieldType === "rating" ? (
                    <RatingSlider
                      value={answers[q.id] ? Number(answers[q.id]) : null}
                      onChange={(v) => setAnswers({ ...answers, [q.id]: String(v) })}
                    />
                  ) : q.fieldType === "boolean" ? (
                    <YesNo
                      name={`q-${q.id}`}
                      value={answers[q.id] ?? ""}
                      onChange={(v) => setAnswers({ ...answers, [q.id]: v })}
                    />
                  ) : q.fieldType === "select" ? (
                    <RadioGroup
                      name={`q-${q.id}`}
                      columns={3}
                      value={answers[q.id] ?? ""}
                      onChange={(v) => setAnswers({ ...answers, [q.id]: v })}
                      options={(q.options ?? []).map((o) => ({ value: o, label: o }))}
                    />
                  ) : (
                    <Textarea
                      rows={2}
                      value={answers[q.id] ?? ""}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                      placeholder="What did they say?"
                    />
                  )}
                </Field>
              ))}
            </FormSection>
          )}

          <FormSection title="Recruiter notes">
            <Field label="Overall notes">
              <Textarea
                rows={4}
                value={form.overallNotes}
                onChange={(e) => setForm({ ...form, overallNotes: e.target.value })}
                placeholder="Motivations, red flags, availability, anything the technical panel should know."
              />
            </Field>
          </FormSection>

          <FormSection title="Decision">
            <RadioGroup
              name="decision"
              columns={1}
              value={form.result}
              onChange={(v) => setForm({ ...form, result: v as typeof form.result })}
              options={[
                {
                  value: "selected",
                  label: "Selected",
                  hint: "Moves straight into the AI interview queue and leaves this page.",
                },
                { value: "hold", label: "Hold", hint: "Yellow tag — keep for future roles." },
                {
                  value: "rejected",
                  label: "Rejected",
                  hint: "Red tag, retained 30 days, restorable by an admin.",
                },
              ]}
            />
          </FormSection>
        </div>
      </Modal>

      {/* Bulk bucket assignment */}
      <Modal
        open={bucketOpen}
        onClose={() => setBucketOpen(false)}
        title={`Move ${checked.size} candidate(s) to a bucket`}
        description="Green proceeds, yellow can be reconsidered later, red carries a critical red flag. You can move candidates between buckets at any time."
        footer={
          <>
            <Button variant="ghost" onClick={() => setBucketOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={setBucketBulk.isPending}
              onClick={() =>
                setBucketBulk.mutate(
                  {
                    candidateIds: [...checked],
                    bucket: bucketForm.bucket as "green" | "yellow" | "red",
                    reason: bucketForm.reason || undefined,
                  },
                  {
                    onSuccess: () => {
                      setBucketOpen(false);
                      setChecked(new Set());
                    },
                  },
                )
              }
            >
              {setBucketBulk.isPending && <Spinner />} Move to bucket
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Bucket">
            <Select
              value={bucketForm.bucket}
              onChange={(e) => setBucketForm({ bucket: e.target.value, reason: "" })}
            >
              <option value="green">Green — Proceed</option>
              <option value="yellow">Yellow — Reconsider later</option>
              <option value="red">Red — Critical red flag</option>
            </Select>
          </Field>
          {bucketForm.bucket !== "green" && (
            <Field label="Reason">
              <Select
                value={bucketForm.reason}
                onChange={(e) => setBucketForm({ ...bucketForm, reason: e.target.value })}
              >
                <option value="">Choose a reason…</option>
                {(bucketForm.bucket === "yellow" ? YELLOW_REASONS : RED_REASONS).map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Modal>

      {/* Add question */}
      <Modal
        open={qOpen}
        onClose={() => setQOpen(false)}
        title={qForm.id ? "Edit screening question" : "Add screening question"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setQOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!qForm.label.trim()) return;
                await saveQuestion.mutateAsync({
                  id: qForm.id || undefined,
                  label: qForm.label.trim(),
                  fieldType: qForm.fieldType as "text" | "rating" | "boolean" | "select",
                  options: qForm.options
                    ? qForm.options.split(",").map((o) => o.trim()).filter(Boolean)
                    : undefined,
                  sortOrder: qForm.id ? qForm.sortOrder : (questions.data?.length ?? 0) + 1,
                });
                setQForm({ id: "", label: "", fieldType: "text", options: "", sortOrder: 0 });
                setQOpen(false);
              }}
              disabled={saveQuestion.isPending}
            >
              {saveQuestion.isPending && <Spinner />} {qForm.id ? "Save changes" : "Add"}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <Field label="Question">
            <Input
              value={qForm.label}
              onChange={(e) => setQForm({ ...qForm, label: e.target.value })}
              placeholder="Why are you looking to move?"
            />
          </Field>
          <Field label="Answer type">
            <Select value={qForm.fieldType} onChange={(e) => setQForm({ ...qForm, fieldType: e.target.value })}>
              <option value="text">Free text</option>
              <option value="rating">Rating 1–10</option>
              <option value="boolean">Yes / No</option>
              <option value="select">Choice list</option>
            </Select>
          </Field>
          {qForm.fieldType === "select" && (
            <Field label="Options" hint="Comma separated.">
              <Input
                value={qForm.options}
                onChange={(e) => setQForm({ ...qForm, options: e.target.value })}
                placeholder="Immediate, 1 month, 2 months"
              />
            </Field>
          )}
        </div>
      </Modal>
    </>
  );
}
