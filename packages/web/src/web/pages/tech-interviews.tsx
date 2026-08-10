import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Bot, Cpu, ListChecks, Plus, Sparkles, TimerOff, Trash2, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, SectionTitle } from "../components/ui/card";
import { ChipList, PageHeader, StatCard } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Badge, StatusBadge } from "../components/ui/badge";
import { Field, Input, Select, Textarea } from "../components/ui/field";
import { EmptyState, ErrorNote, LoadingBlock, Spinner } from "../components/ui/feedback";
import { Modal, Tabs } from "../components/ui/modal";
import { Meter, ScorePill, ScoreRing } from "../components/ui/score";
import {
  useSaveTechTemplate,
  useRemoveTechTemplate,
  useSubmitTechInterview,
  useTechInterviews,
  useTechQueue,
  useTechTemplates,
} from "../queries/interviews";
import { useMe } from "../queries/session";
import { useSettings } from "../queries/insights";

type Tab = "queue" | "completed" | "templates";

export default function TechInterviewsPage() {
  const queue = useTechQueue();
  const list = useTechInterviews();
  const templates = useTechTemplates();
  const submit = useSubmitTechInterview();
  const saveTemplate = useSaveTechTemplate();
  const removeTemplate = useRemoveTechTemplate();
  const settings = useSettings();
  const me = useMe();
  const isAdmin = me.data && "user" in me.data && ["super_admin", "agency_admin"].includes(me.data.user.role);

  const [tab, setTab] = useState<Tab>("queue");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [scores, setScores] = useState<Record<string, Record<string, number>>>({});
  const [comments, setComments] = useState("");
  const [reason, setReason] = useState("");
  const [recommendation, setRecommendation] = useState<"selected" | "hold" | "rejected">("selected");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ total: number; final: number | null } | null>(null);

  const [tplOpen, setTplOpen] = useState(false);
  const [tplForm, setTplForm] = useState({
    name: "",
    ratingScaleMax: 10,
    isDefault: false,
    sections: "Technical Knowledge|40|Core concepts, Depth, Tooling\nProblem Solving|35|Approach, Edge cases, Debugging\nCommunication|25|Clarity, Collaboration",
  });

  const candidate = useMemo(() => (queue.data ?? []).find((c) => c.id === activeId) ?? null, [queue.data, activeId]);
  const template = (templates.data ?? []).find((t) => t.id === templateId) ?? templates.data?.[0] ?? null;

  useEffect(() => {
    if (!templateId && templates.data?.length) {
      setTemplateId(templates.data.find((t) => t.isDefault)?.id ?? templates.data[0]!.id);
    }
  }, [templates.data, templateId]);

  /** Live weighted preview mirroring the server formula. */
  const previewTotal = useMemo(() => {
    if (!template?.sections?.length) return 0;
    const weightSum = template.sections.reduce((s, x) => s + x.weight, 0) || 1;
    let total = 0;
    for (const section of template.sections) {
      const params = scores[section.name] ?? {};
      const values = section.parameters.map((p) => params[p] ?? 0);
      const avg = values.reduce((s, v) => s + v, 0) / (values.length || 1);
      total += (avg / template.ratingScaleMax) * (section.weight / weightSum) * 100;
    }
    return Math.round(total * 10) / 10;
  }, [template, scores]);

  function open(id: string) {
    setActiveId(id);
    setScores({});
    setComments("");
    setReason("");
    setRecommendation("selected");
    setError(null);
    setResult(null);
  }

  async function save() {
    if (!candidate || !template) return;
    setError(null);
    try {
      const res = await submit.mutateAsync({
        candidateId: candidate.id,
        jdId: candidate.jdId ?? undefined,
        templateId: template.id,
        sectionScores: scores,
        comments: comments || undefined,
        selectionReason: reason || undefined,
        recommendation,
      });
      setResult({ total: res.totalScore, final: res.finalScore });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const rows = queue.data ?? [];
  const done = list.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Interviews"
        title="Technical interview"
        subtitle={`Templated, weighted evaluation — the primary signal. Final candidate score = match × ${
          settings.data?.values.matchWeight ?? 0.2
        } + technical × ${settings.data?.values.techWeight ?? 0.8}.`}
        actions={
          isAdmin ? (
            <Button variant="outline" onClick={() => setTab("templates")}>
              <ListChecks className="size-4" /> Evaluation templates
            </Button>
          ) : undefined
        }
      />

      <div className="rise rise-2 mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Awaiting evaluation" value={rows.length} icon={Bot} tone="primary" />
        <StatCard label="Completed" value={done.length} icon={Trophy} tone="success" />
        <StatCard
          label="Average score"
          value={
            done.length
              ? (done.reduce((s, r) => s + r.interview.totalScore, 0) / done.length).toFixed(1)
              : "—"
          }
          icon={Cpu}
          tone="info"
        />
        <StatCard
          label="Selected"
          value={done.filter((r) => r.interview.recommendation === "selected").length}
          icon={Sparkles}
          tone="warning"
        />
      </div>

      <Tabs
        className="rise rise-2 mb-4 w-fit"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "queue", label: "Interview queue", count: rows.length },
          { value: "completed", label: "Completed", count: done.length },
          { value: "templates", label: "Templates", count: templates.data?.length },
        ]}
      />

      {tab === "queue" && (
        <div className="rise rise-3">
          {queue.isLoading && <LoadingBlock rows={3} />}
          {!queue.isLoading && rows.length === 0 && (
            <EmptyState
              icon={Bot}
              title="Nobody in the technical queue"
              body="Candidates who complete the AI voice interview arrive here with suggested focus areas attached."
              action={
                <Link
                  to="/ai-interviews"
                  className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                >
                  Open AI interviews
                </Link>
              }
            />
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {rows.map((row) => (
              <Card key={row.id} hover className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/candidates/${row.id}`}>
                      <h3 className="truncate font-display text-[15px] font-semibold hover:text-primary-light">
                        {row.firstName} {row.lastName}
                      </h3>
                    </Link>
                    <p className="truncate text-[12.5px] text-muted-foreground">{row.headline}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <StatusBadge status={row.currentStatus} />
                    {row.scoreExpired ? (
                      <Badge tone="warning">
                        <TimerOff className="size-3" /> score expired
                      </Badge>
                    ) : (
                      <ScorePill score={row.matchScore} />
                    )}
                  </div>
                </div>

                {(row.suggestedTechFocus ?? []).length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                      AI suggests probing
                    </p>
                    <ChipList items={row.suggestedTechFocus ?? []} max={6} />
                  </div>
                )}

                {(row.technologies ?? []).length > 0 && (
                  <div className="mt-2.5">
                    <ChipList items={row.technologies ?? []} max={6} />
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                  <span className="num text-[11.5px] text-muted-foreground">
                    {row.experienceYears != null ? `${row.experienceYears} yrs experience` : "experience unknown"}
                  </span>
                  <Button size="sm" className="ml-auto" onClick={() => open(row.id)}>
                    <Bot className="size-3.5" /> Evaluate
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {tab === "completed" && (
        <div className="rise rise-3 space-y-3">
          {list.isLoading && <LoadingBlock rows={4} />}
          {done.length === 0 && <EmptyState icon={Bot} title="No technical interviews recorded yet" />}
          {done.map((row) => (
            <Card key={row.interview.id} className="p-4">
              <div className="flex flex-wrap items-start gap-4">
                <ScoreRing score={row.interview.totalScore} size={58} label="tech" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/candidates/${row.interview.candidateId}`}>
                      <p className="font-display text-[15px] font-semibold hover:text-primary-light">
                        {row.candidateName}
                      </p>
                    </Link>
                    <StatusBadge status={row.interview.recommendation} />
                    {row.jobTitle && <Badge tone="muted">{row.jobTitle}</Badge>}
                    <span className="num text-[11px] text-muted-foreground">
                      {new Date(row.interview.conductedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {row.interview.comments && (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
                      {row.interview.comments}
                    </p>
                  )}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {Object.entries(row.interview.sectionScores ?? {}).map(([section, params]) => {
                      const values = Object.values(params);
                      const avg = values.reduce((s, v) => s + v, 0) / (values.length || 1);
                      return (
                        <div key={section}>
                          <div className="mb-1 flex items-baseline justify-between gap-2">
                            <span className="truncate text-[12px]">{section}</span>
                            <span className="num text-[11px] text-muted-foreground">{avg.toFixed(1)}</span>
                          </div>
                          <Meter value={avg} max={10} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === "templates" && (
        <div className="rise rise-3">
          <SectionTitle
            title="Evaluation templates"
            hint="Sections carry weights that sum to the total; each parameter is rated on the template's scale."
            right={
              isAdmin ? (
                <Button size="sm" onClick={() => setTplOpen(true)}>
                  <Plus className="size-3.5" /> New template
                </Button>
              ) : undefined
            }
          />
          {templates.isLoading && <LoadingBlock rows={2} />}
          <div className="grid gap-3 lg:grid-cols-2">
            {(templates.data ?? []).map((t) => (
              <Card key={t.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-[15px] font-semibold">{t.name}</h3>
                    <p className="num text-[11.5px] text-muted-foreground">
                      scale 1–{t.ratingScaleMax} · {(t.sections ?? []).length} sections
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {t.isDefault && <Badge tone="primary">default</Badge>}
                    {isAdmin && !t.isDefault && (
                      <button
                        type="button"
                        onClick={() => removeTemplate.mutate({ id: t.id })}
                        className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-3 space-y-2.5">
                  {(t.sections ?? []).map((section) => (
                    <div key={section.name}>
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <span className="text-[12.5px]">{section.name}</span>
                        <span className="num text-[11px] text-primary">{section.weight}%</span>
                      </div>
                      <ChipList items={section.parameters} max={8} />
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Evaluation form */}
      <Modal
        open={Boolean(candidate)}
        onClose={() => setActiveId(null)}
        title={candidate ? `Evaluate ${candidate.firstName} ${candidate.lastName ?? ""}` : ""}
        description="Rate each parameter. The weighted total becomes 80% of the candidate's final score."
        width="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setActiveId(null)}>
              Close
            </Button>
            {!result && (
              <Button onClick={save} disabled={submit.isPending || !template}>
                {submit.isPending && <Spinner />} Submit evaluation
              </Button>
            )}
          </>
        }
      >
        {result ? (
          <div className="py-4 text-center">
            <ScoreRing score={result.total} size={92} label="tech" className="mx-auto" />
            <p className="mt-4 font-display text-[17px] font-semibold">Evaluation saved</p>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              Technical score {result.total}
              {result.final != null ? ` · final score ${result.final}` : " · final score pending a live match"}
            </p>
            {candidate && (
              <Link
                to={`/candidates/${candidate.id}`}
                className="mt-4 inline-block text-[12.5px] text-primary-light hover:underline"
              >
                Open the candidate report →
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {error && <ErrorNote message={error} />}

            <div className="flex flex-wrap items-end gap-3">
              <Field label="Template" className="min-w-[220px] flex-1">
                <Select value={template?.id ?? ""} onChange={(e) => setTemplateId(e.target.value)}>
                  {(templates.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-center gap-3 rounded-lg border border-border bg-white/[0.02] px-4 py-2">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Live total</span>
                <span className="num font-display text-[22px] font-bold text-primary">{previewTotal}</span>
              </div>
            </div>

            {candidate && (candidate.suggestedTechFocus ?? []).length > 0 && (
              <Card className="border-primary/25 p-3.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  AI interview suggested probing
                </p>
                <ChipList items={candidate.suggestedTechFocus ?? []} max={10} />
              </Card>
            )}

            {(template?.sections ?? []).map((section) => (
              <div key={section.name} className="rounded-lg border border-border p-3.5">
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <p className="font-display text-[14px] font-semibold">{section.name}</p>
                  <span className="num text-[11.5px] text-primary">weight {section.weight}%</span>
                </div>
                <div className="space-y-3">
                  {section.parameters.map((param) => {
                    const value = scores[section.name]?.[param] ?? 0;
                    return (
                      <div key={param} className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate text-[12.5px]">{param}</span>
                        <input
                          type="range"
                          min={0}
                          max={template?.ratingScaleMax ?? 10}
                          value={value}
                          onChange={(e) =>
                            setScores({
                              ...scores,
                              [section.name]: {
                                ...(scores[section.name] ?? {}),
                                [param]: Number(e.target.value),
                              },
                            })
                          }
                          className="h-1.5 w-40 accent-[#ff6b2b]"
                        />
                        <span className="num w-10 text-right text-[12.5px] font-semibold">
                          {value}/{template?.ratingScaleMax ?? 10}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <Field label="Interviewer comments">
              <Textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="How they handled the system design prompt, code quality, reasoning under pressure."
              />
            </Field>
            <Field label="Selection reasoning" hint="Shown on the final recruitment report.">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Technical depth is at level for a senior backend role."
              />
            </Field>
            <Field label="Recommendation">
              <Select
                value={recommendation}
                onChange={(e) => setRecommendation(e.target.value as typeof recommendation)}
              >
                <option value="selected">Selected — advance to client review</option>
                <option value="hold">Hold</option>
                <option value="rejected">Rejected</option>
              </Select>
            </Field>
          </div>
        )}
      </Modal>

      {/* Template editor */}
      <Modal
        open={tplOpen}
        onClose={() => setTplOpen(false)}
        title="New evaluation template"
        description="One section per line: Name|Weight|Parameter, Parameter, Parameter"
        width="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTplOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const sections = tplForm.sections
                  .split("\n")
                  .map((line) => line.split("|"))
                  .filter((parts) => parts.length >= 3)
                  .map((parts) => ({
                    name: parts[0]!.trim(),
                    weight: Number(parts[1]!.trim()) || 0,
                    parameters: parts[2]!.split(",").map((p) => p.trim()).filter(Boolean),
                  }))
                  .filter((s) => s.name && s.parameters.length > 0);
                if (!tplForm.name.trim() || sections.length === 0) return;
                await saveTemplate.mutateAsync({
                  name: tplForm.name.trim(),
                  ratingScaleMax: tplForm.ratingScaleMax,
                  sections,
                  isDefault: tplForm.isDefault,
                });
                setTplOpen(false);
              }}
              disabled={saveTemplate.isPending}
            >
              {saveTemplate.isPending && <Spinner />} Save template
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <Field label="Template name">
            <Input
              value={tplForm.name}
              onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })}
              placeholder="Backend Engineering — Senior"
            />
          </Field>
          <Field label="Rating scale max">
            <Input
              type="number"
              min={3}
              max={100}
              value={tplForm.ratingScaleMax}
              onChange={(e) => setTplForm({ ...tplForm, ratingScaleMax: Number(e.target.value) })}
            />
          </Field>
          <Field label="Sections" hint="Weights should add up to 100.">
            <Textarea
              value={tplForm.sections}
              onChange={(e) => setTplForm({ ...tplForm, sections: e.target.value })}
              className="min-h-[130px] font-mono text-[12px]"
            />
          </Field>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={tplForm.isDefault}
              onChange={(e) => setTplForm({ ...tplForm, isDefault: e.target.checked })}
              className="accent-[#ff6b2b]"
            />
            Make this the default template
          </label>
        </div>
      </Modal>
    </>
  );
}
