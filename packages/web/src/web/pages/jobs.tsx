import { useState } from "react";
import { Link } from "wouter";
import { Briefcase, FileUp, Plus, RefreshCw, Sparkles, TimerOff, Trash2, Users } from "lucide-react";
import { Card } from "../components/ui/card";
import { PageHeader, StatCard } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Badge, StatusBadge } from "../components/ui/badge";
import { Field, Input, Select, Textarea } from "../components/ui/field";
import { EmptyState, ErrorNote, LoadingBlock, Spinner } from "../components/ui/feedback";
import { Modal, Tabs } from "../components/ui/modal";
import { useConfirm, useToast } from "../components/ui/toast";
import { CURRENCIES, formatSalaryRange, parseAmountInput, SALARY_PERIODS } from "../lib/currency";
import { ScorePill } from "../components/ui/score";
import { useClients } from "../queries/clients";
import { useCreateJob, useDeleteJob, useJobs, useReparseJob } from "../queries/jobs";
import { uploadFile } from "../queries/candidates";

type Filter = "open" | "on_hold" | "filled" | "closed" | "all";

export default function JobsPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("open");
  const jobs = useJobs(filter === "all" ? undefined : filter);
  const allJobs = useJobs();
  const clients = useClients();
  const create = useCreateJob();
  const reparse = useReparseJob();
  const remove = useDeleteJob();

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    title: "",
    clientId: "",
    department: "",
    location: "",
    experienceLevel: "mid",
    salaryCurrency: "LKR",
    salaryMin: "",
    salaryMax: "",
    salaryPeriod: "month",
    priority: "medium",
    openings: 1,
    jdText: "",
    jdFilePath: "",
    jdFileName: "",
  });

  const counts = {
    open: (allJobs.data ?? []).filter((j) => j.status === "open").length,
    on_hold: (allJobs.data ?? []).filter((j) => j.status === "on_hold").length,
    filled: (allJobs.data ?? []).filter((j) => j.status === "filled").length,
    closed: (allJobs.data ?? []).filter((j) => j.status === "closed").length,
    all: (allJobs.data ?? []).length,
  };

  const totals = (allJobs.data ?? []).reduce(
    (acc, j) => ({
      matches: acc.matches + j.liveMatchCount,
      expired: acc.expired + j.expiredMatchCount,
      shortlisted: acc.shortlisted + j.shortlistedCount,
      unparsed: acc.unparsed + (j.isParsed ? 0 : 1),
    }),
    { matches: 0, expired: 0, shortlisted: 0, unparsed: 0 },
  );

  async function pickFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const { key, filename } = await uploadFile(file, "jd");
      setForm((f) => ({ ...f, jdFilePath: key, jdFileName: filename }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setError(null);
    if (!form.title.trim()) return setError("Job title is required");
    if (!form.jdFilePath && !form.jdText.trim()) {
      return setError("Upload the JD document or paste the job description text");
    }
    try {
      await create.mutateAsync({
        title: form.title.trim(),
        clientId: form.clientId || undefined,
        department: form.department || undefined,
        location: form.location || undefined,
        experienceLevel: form.experienceLevel || undefined,
        salaryCurrency: form.salaryCurrency,
        salaryMin: parseAmountInput(form.salaryMin) ?? undefined,
        salaryMax: parseAmountInput(form.salaryMax) ?? undefined,
        salaryPeriod: form.salaryPeriod as "hour" | "day" | "month" | "year",
        priority: form.priority as "low" | "medium" | "high" | "urgent",
        openings: Number(form.openings) || 1,
        jdText: form.jdText || undefined,
        jdFilePath: form.jdFilePath || undefined,
        jdFileName: form.jdFileName || undefined,
      });
      setOpen(false);
      setForm({ ...form, title: "", jdText: "", jdFilePath: "", jdFileName: "" });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Sourcing"
        title="Job descriptions"
        subtitle="The JD document is the source of truth for matching — it is parsed, embedded and scored against every CV in your library."
        actions={
          <Button onClick={() => setOpen(true)} className="glow-primary">
            <Plus className="size-4" /> New job description
          </Button>
        }
      />

      <div className="rise rise-2 mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open roles" value={counts.open} icon={Briefcase} tone="primary" />
        <StatCard label="Expired scores" value={totals.expired} hint="Excluded from ranking" icon={TimerOff} tone="warning" />
        <StatCard
          label="Unparsed JDs"
          value={totals.unparsed}
          hint="Re-parse before running a match"
          icon={Sparkles}
          tone={totals.unparsed > 0 ? "danger" : "info"}
        />
      </div>

      <Tabs
        className="rise rise-2 mb-4 w-fit"
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: "open", label: "Open", count: counts.open },
          { value: "on_hold", label: "On hold", count: counts.on_hold },
          { value: "filled", label: "Filled", count: counts.filled },
          { value: "closed", label: "Closed", count: counts.closed },
          { value: "all", label: "All", count: counts.all },
        ]}
      />

      {jobs.isLoading && <LoadingBlock rows={4} />}

      {jobs.data?.length === 0 && (
        <EmptyState
          icon={Briefcase}
          title={filter === "open" ? "No open roles" : "Nothing here"}
          body="Create a job description and upload the JD document — parsing, skill extraction and embedding happen automatically."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New job description
            </Button>
          }
        />
      )}

      <div className="rise rise-3 grid gap-3 lg:grid-cols-2">
        {(jobs.data ?? []).map((job) => (
          <Card key={job.id} hover className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to={`/jobs/${job.id}`} className="block">
                  <h3 className="truncate font-display text-[16px] font-semibold hover:text-primary-light">
                    {job.title}
                  </h3>
                </Link>
                <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                  {[job.clientName, job.department, job.location].filter(Boolean).join(" · ") || "No client attached"}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <StatusBadge status={job.status} />
                <StatusBadge status={job.priority} />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
              <Badge tone="muted">{job.openings} opening{job.openings > 1 ? "s" : ""}</Badge>
              {job.salaryRange && <Badge tone="muted">{job.salaryRange}</Badge>}
              {job.experienceLevel && <Badge tone="muted">{job.experienceLevel}</Badge>}
              {!job.isParsed && <Badge tone="danger">JD not parsed</Badge>}
            </div>

            {(job.skillsRequired ?? []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(job.skillsRequired ?? []).slice(0, 7).map((skill) => (
                  <span key={skill} className="rounded border border-border bg-white/[0.03] px-1.5 py-0.5 text-[11px]">
                    {skill}
                  </span>
                ))}
                {(job.skillsRequired ?? []).length > 7 && (
                  <span className="px-1 text-[11px] text-muted-foreground">
                    +{(job.skillsRequired ?? []).length - 7}
                  </span>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-[12px]">
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Best</span>
                <ScorePill score={job.bestScore} />
              </span>
              <span className="text-muted-foreground">
                <span className="num font-semibold text-foreground">{job.liveMatchCount}</span> matched
              </span>
              <span className="text-muted-foreground">
                <span className="num font-semibold text-primary">{job.shortlistedCount}</span> shortlisted
              </span>
              {job.expiredMatchCount > 0 && (
                <span className="flex items-center gap-1 text-warning">
                  <TimerOff className="size-3" />
                  <span className="num font-semibold">{job.expiredMatchCount}</span> expired
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => reparse.mutate({ id: job.id })}
                  disabled={reparse.isPending}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] transition-colors hover:border-border-hover"
                >
                  <RefreshCw className={reparse.isPending ? "size-3 animate-spin" : "size-3"} /> Re-parse
                </button>
                <Link
                  to={`/jobs/${job.id}`}
                  className="rounded-md border border-primary/35 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary-light transition-colors hover:bg-primary/15"
                >
                  Shortlist
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Delete "${job.title}"?`,
                      description: "All of its match records are removed too.",
                      confirmLabel: "Delete job",
                      tone: "danger",
                    });
                    if (!ok) return;
                    remove.mutate(
                      { id: job.id },
                      {
                        onSuccess: () => toast({ tone: "success", title: "Job deleted" }),
                        onError: (error) =>
                          toast({ tone: "error", title: "Delete failed", description: error.message }),
                      },
                    );
                  }}
                  className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New job description"
        description="Upload the original JD document (PDF or DOCX) — matching scores CVs against the document itself, not a summary."
        width="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={create.isPending || uploading}>
              {create.isPending && <Spinner />}
              Create & parse
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {error && <ErrorNote message={error} />}
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Job title" className="sm:col-span-2">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Senior Backend Engineer"
              />
            </Field>
            <Field label="Client">
              <Select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                <option value="">No client</option>
                {(clients.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Department">
              <Input
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                placeholder="Engineering"
              />
            </Field>
            <Field label="Location">
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Colombo, Sri Lanka"
              />
            </Field>
            <Field
              label="Salary range"
              hint={
                parseAmountInput(form.salaryMin) != null || parseAmountInput(form.salaryMax) != null
                  ? formatSalaryRange({
                      currency: form.salaryCurrency,
                      min: parseAmountInput(form.salaryMin),
                      max: parseAmountInput(form.salaryMax),
                      period: form.salaryPeriod,
                    })
                  : "Pick a currency and a range — this format carries through matching, placements and reports."
              }
            >
              <div className="flex flex-wrap gap-2">
                <Select
                  value={form.salaryCurrency}
                  onChange={(e) => setForm({ ...form, salaryCurrency: e.target.value })}
                  className="num w-[92px] shrink-0"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
                <Input
                  className="num min-w-[96px] flex-1"
                  inputMode="decimal"
                  value={form.salaryMin}
                  onChange={(e) => setForm({ ...form, salaryMin: e.target.value })}
                  placeholder="550,000.00"
                />
                <Input
                  className="num min-w-[96px] flex-1"
                  inputMode="decimal"
                  value={form.salaryMax}
                  onChange={(e) => setForm({ ...form, salaryMax: e.target.value })}
                  placeholder="750,000.00"
                />
                <Select
                  value={form.salaryPeriod}
                  onChange={(e) => setForm({ ...form, salaryPeriod: e.target.value })}
                  className="w-[104px] shrink-0"
                >
                  {SALARY_PERIODS.map((period) => (
                    <option key={period} value={period}>
                      per {period}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
            <Field label="Experience level">
              <Select
                value={form.experienceLevel}
                onChange={(e) => setForm({ ...form, experienceLevel: e.target.value })}
              >
                <option value="junior">Junior</option>
                <option value="mid">Mid</option>
                <option value="senior">Senior</option>
                <option value="lead">Lead</option>
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            </Field>
            <Field label="Openings">
              <Input
                type="number"
                min={1}
                value={form.openings}
                onChange={(e) => setForm({ ...form, openings: Number(e.target.value) })}
              />
            </Field>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              JD document
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border px-4 py-4 transition-colors hover:border-primary/50">
              <input
                type="file"
                accept=".pdf,.docx,.doc,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void pickFile(file);
                }}
              />
              {uploading ? <Spinner className="text-primary" /> : <FileUp className="size-4 text-primary" />}
              <span className="text-[13px]">
                {form.jdFileName ? (
                  <span className="text-success">{form.jdFileName} uploaded</span>
                ) : (
                  <>
                    <span className="font-medium">Click to upload</span>
                    <span className="text-muted-foreground"> — PDF, DOCX or TXT</span>
                  </>
                )}
              </span>
            </label>
          </div>

          <Field label="Or paste the JD text" hint="Used when no document is uploaded.">
            <Textarea
              value={form.jdText}
              onChange={(e) => setForm({ ...form, jdText: e.target.value })}
              placeholder="Responsibilities, required skills, minimum experience, education…"
              className="min-h-[120px]"
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
