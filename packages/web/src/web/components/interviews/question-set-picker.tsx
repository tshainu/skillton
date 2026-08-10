import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Check, ListChecks, Search } from "lucide-react";
import { Input } from "../ui/field";
import { Badge } from "../ui/badge";
import { EmptyState, LoadingBlock } from "../ui/feedback";
import { useQuestionSets } from "../../queries/question-sets";

/**
 * Searchable list of the agency's AI interview question sets. Choosing one here
 * pins it to the invite, so the interviewer works through exactly those
 * questions instead of guessing a set from the job title.
 */
export function QuestionSetPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const sets = useQuestionSets();
  const [query, setQuery] = useState("");

  const active = useMemo(() => (sets.data?.sets ?? []).filter((s) => s.isActive), [sets.data]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return active;
    return active.filter((s) =>
      [s.jobTitle, s.jdTitle, s.description, ...s.questions.map((x) => x.question)]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q)),
    );
  }, [active, query]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          className="pl-9"
          placeholder="Search question sets by role, description or question…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {sets.isLoading && <LoadingBlock rows={3} />}

      {!sets.isLoading && active.length === 0 && (
        <EmptyState
          icon={ListChecks}
          title="No question sets yet"
          body="Create one in Settings → AI interview so the interviewer knows what to ask."
          action={
            <Link
              to="/settings"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Open settings
            </Link>
          }
        />
      )}

      {!sets.isLoading && active.length > 0 && (
        <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
          {matches.length === 0 && (
            <p className="py-6 text-center text-[12.5px] text-muted-foreground">
              No question set matches “{query}”.
            </p>
          )}
          {matches.map((set) => {
            const selected = set.id === value;
            return (
              <button
                key={set.id}
                type="button"
                onClick={() => onChange(selected ? null : set.id)}
                className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${
                  selected ? "border-primary/60 bg-primary/5" : "border-border/60 hover:border-border-hover"
                }`}
              >
                <span
                  className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${
                    selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  }`}
                >
                  {selected && <Check className="size-2.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">{set.jobTitle}</span>
                    <Badge tone="muted">{set.questionCount} questions</Badge>
                    {set.jdTitle && <Badge tone="info">{set.jdTitle}</Badge>}
                  </span>
                  {set.description && (
                    <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{set.description}</span>
                  )}
                  {set.questions[0] && (
                    <span className="mt-1 block truncate text-[11.5px] text-muted-foreground/70">
                      1. {set.questions[0].question}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
