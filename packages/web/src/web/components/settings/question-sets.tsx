import { useState } from "react";
import { ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, SectionTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useConfirm, useToast } from "@/components/ui/toast";
import { EmptyState, LoadingBlock, Spinner } from "@/components/ui/feedback";
import {
  useCreateQuestionSet,
  useQuestionSets,
  useRemoveQuestionSet,
  useUpdateQuestionSet,
} from "@/queries/question-sets";

/**
 * AI interview question banks — one set per job title, optionally pinned to a
 * single JD. The voice agent is instructed to ask only from the matching set.
 */

interface DraftQuestion {
  question: string;
  followUps: string;
}

interface Draft {
  id: string;
  jobTitle: string;
  jdId: string;
  description: string;
  questions: DraftQuestion[];
}

const EMPTY: Draft = { id: "", jobTitle: "", jdId: "", description: "", questions: [{ question: "", followUps: "" }] };

export function QuestionSetsSettings({ canEdit }: { canEdit: boolean }) {
  const confirm = useConfirm();
  const toast = useToast();
  const { data, isLoading } = useQuestionSets();
  const create = useCreateQuestionSet();
  const update = useUpdateQuestionSet();
  const remove = useRemoveQuestionSet();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  function edit(setId: string) {
    const set = data?.sets.find((s) => s.id === setId);
    if (!set) return;
    setDraft({
      id: set.id,
      jobTitle: set.jobTitle,
      jdId: set.jdId ?? "",
      description: set.description ?? "",
      questions: set.questions.length
        ? set.questions.map((q) => ({ question: q.question, followUps: q.followUps.join(" | ") }))
        : [{ question: "", followUps: "" }],
    });
    setError(null);
    setOpen(true);
  }

  async function save() {
    setError(null);
    const questions = draft.questions
      .filter((q) => q.question.trim())
      .map((q) => ({
        question: q.question.trim(),
        followUps: q.followUps
          .split("|")
          .map((f) => f.trim())
          .filter(Boolean),
      }));

    if (!draft.jobTitle.trim()) return setError("A job title is required.");
    if (!questions.length) return setError("Add at least one question.");

    try {
      if (draft.id) {
        await update.mutateAsync({
          id: draft.id,
          jobTitle: draft.jobTitle.trim(),
          jdId: draft.jdId || null,
          description: draft.description || null,
          questions,
        });
      } else {
        await create.mutateAsync({
          jobTitle: draft.jobTitle.trim(),
          jdId: draft.jdId || undefined,
          description: draft.description || undefined,
          questions,
        });
      }
      setOpen(false);
      setDraft(EMPTY);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <SectionTitle
        title="AI interview question sets"
        hint="Per job title. The voice agent may only ask these questions and their follow-ups — nothing off-topic."
        right={
          canEdit ? (
            <Button
              size="sm"
              onClick={() => {
                setDraft(EMPTY);
                setError(null);
                setOpen(true);
              }}
            >
              <Plus className="size-3.5" /> New question set
            </Button>
          ) : undefined
        }
      />

      {isLoading && <LoadingBlock rows={3} />}

      {!isLoading && data?.sets.length === 0 && (
        <EmptyState
          icon={ListChecks}
          title="No question sets yet"
          body="Without a set the interviewer falls back to a generic screening script. Add a set per job title to keep every interview on topic."
        />
      )}

      {(data?.sets ?? []).map((set) => (
        <Card key={set.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-[14.5px] font-semibold">{set.jobTitle}</p>
              <p className="text-[12px] text-muted-foreground">
                {set.description ?? "No description"}
                {set.jdTitle ? ` · pinned to ${set.jdTitle}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={set.isActive ? "success" : "muted"}>
                {set.questionCount} question{set.questionCount === 1 ? "" : "s"}
              </Badge>
              {canEdit && (
                <>
                  <button
                    type="button"
                    title="Edit question set"
                    onClick={() => edit(set.id)}
                    className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Delete question set"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete the question set for ${set.jobTitle}?`,
                        confirmLabel: "Delete set",
                        tone: "danger",
                      });
                      if (!ok) return;
                      remove.mutate(
                        { id: set.id },
                        {
                          onSuccess: () => toast({ tone: "success", title: "Question set deleted" }),
                          onError: (error) =>
                            toast({ tone: "error", title: "Delete failed", description: error.message }),
                        },
                      );
                    }}
                    className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>

          <ol className="mt-3 space-y-1.5 border-t border-border pt-3">
            {set.questions.map((q, i) => (
              <li key={i} className="text-[12.5px] leading-relaxed">
                <span className="num mr-2 text-muted-foreground">{i + 1}.</span>
                {q.question}
                {q.followUps.length > 0 && (
                  <span className="mt-0.5 block pl-6 text-[11.5px] text-muted-foreground">
                    Follow-ups: {q.followUps.join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </Card>
      ))}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width="max-w-2xl"
        title={draft.id ? "Edit question set" : "New question set"}
        description="Separate multiple follow-ups with a pipe (|). The agent uses a follow-up only when an answer is vague."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={create.isPending || update.isPending}>
              {(create.isPending || update.isPending) && <Spinner />}
              {draft.id ? "Save changes" : "Create set"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <p className="text-[12px] text-destructive">{error}</p>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Job title" hint="Matched case-insensitively against the JD title">
              <Input
                list="question-set-titles"
                value={draft.jobTitle}
                onChange={(e) => setDraft({ ...draft, jobTitle: e.target.value })}
                placeholder="Senior Backend Engineer"
              />
              <datalist id="question-set-titles">
                {(data?.titles ?? []).map((title) => (
                  <option key={title} value={title} />
                ))}
              </datalist>
            </Field>
            <Field label="Pin to a specific JD" hint="Optional — overrides the title match">
              <Select value={draft.jdId} onChange={(e) => setDraft({ ...draft, jdId: e.target.value })}>
                <option value="">Any JD with this title</option>
                {(data?.jobs ?? []).map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.title}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Description">
            <Input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="What this set is for"
            />
          </Field>

          <div className="space-y-3">
            {draft.questions.map((q, index) => (
              <Card key={index} className="space-y-2.5 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Question {index + 1}
                  </span>
                  {draft.questions.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({ ...draft, questions: draft.questions.filter((_, i) => i !== index) })
                      }
                      className="text-[11px] text-muted-foreground hover:text-destructive"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <Textarea
                  value={q.question}
                  onChange={(e) => {
                    const next = [...draft.questions];
                    next[index] = { ...q, question: e.target.value };
                    setDraft({ ...draft, questions: next });
                  }}
                  placeholder="Walk me through a system you owned end to end."
                  className="min-h-[56px]"
                />
                <Input
                  value={q.followUps}
                  onChange={(e) => {
                    const next = [...draft.questions];
                    next[index] = { ...q, followUps: e.target.value };
                    setDraft({ ...draft, questions: next });
                  }}
                  placeholder="Follow-up one | Follow-up two"
                />
              </Card>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDraft({ ...draft, questions: [...draft.questions, { question: "", followUps: "" }] })
              }
            >
              <Plus className="size-3.5" /> Add question
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
