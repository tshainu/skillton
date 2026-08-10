import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeftRight, Check, ChevronDown, Loader2, Search, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { PageHeader, StatCard, TableShell, Td, Th, Tr, ChipList } from "@/components/ui/page";
import { ScorePill } from "@/components/ui/score";
import { EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { BUCKET_CLASS, isBucket, titleCase } from "@/lib/labels";
import {
  useCandidateOptions,
  useCandidatesForJd,
  useJdOptions,
  useJdsForCandidate,
  useSendToScreening,
} from "@/queries/matrix";

/**
 * JD CV Matrix — two directions of the same engine.
 *
 * JD -> CV ranks the live candidate pool for one job and lets the recruiter push
 * a checked selection straight into HR screening. CV -> JD does the reverse for
 * one candidate, searchable by name, NIC or phone.
 */

type Tab = "jd" | "cv";

/** Searchable dropdown — a filter box over a scrollable option list. */
function SearchSelect<T extends { id: string; label: string }>({
  options,
  value,
  onChange,
  placeholder,
  query,
  onQueryChange,
  loading,
  renderOption,
}: {
  options: T[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder: string;
  query: string;
  onQueryChange: (q: string) => void;
  loading?: boolean;
  renderOption?: (option: T) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value) ?? null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-border bg-[#141414] px-3 text-left text-sm transition-colors hover:border-primary/40"
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1.5 w-full overflow-hidden rounded-lg border border-border bg-[#111] shadow-2xl">
            <div className="relative border-b border-border">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="Search…"
                className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-[#6b6b6b]"
              />
            </div>
            <div className="max-h-72 overflow-y-auto">
              {loading && (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">Searching…</p>
              )}
              {!loading && options.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matches</p>
              )}
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-white/[0.04]",
                    option.id === value && "bg-primary/10 text-primary-light",
                  )}
                >
                  {renderOption ? renderOption(option) : <span className="truncate">{option.label}</span>}
                  {option.id === value && <Check className="size-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function JdToCv() {
  const [jdQuery, setJdQuery] = useState("");
  const [jdId, setJdId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const { data: jds, isLoading: jdsLoading } = useJdOptions();
  const { data, isFetching } = useCandidatesForJd(jdId);
  const sendToScreening = useSendToScreening();

  const options = useMemo(() => {
    const q = jdQuery.trim().toLowerCase();
    const all = (jds ?? []).map((j) => ({ ...j, id: j.id, label: j.label }));
    return q ? all.filter((j) => j.search.includes(q)) : all;
  }, [jds, jdQuery]);

  const rows = data?.rows ?? [];
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.candidateId));

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Job description
        </p>
        <SearchSelect
          options={options}
          value={jdId}
          onChange={(id) => {
            setJdId(id);
            setChecked(new Set());
          }}
          query={jdQuery}
          onQueryChange={setJdQuery}
          loading={jdsLoading}
          placeholder="Choose a job description — search by title, client or location"
          renderOption={(option) => (
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{option.label}</span>
              {"location" in option && option.location ? (
                <span className="ml-2 text-[11px] text-muted-foreground">{String(option.location)}</span>
              ) : null}
            </span>
          )}
        />
      </Card>

      {!jdId && (
        <EmptyState
          icon={ArrowLeftRight}
          title="Pick a job description"
          body="Choose a JD above and the engine ranks the ten best-suited candidates from the live pool."
        />
      )}

      {jdId && isFetching && !data && (
        <Card className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Scoring the candidate pool…
        </Card>
      )}

      {jdId && data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Pool scored" value={data.poolSize} icon={Users} />
            <StatCard label="Top matches shown" value={rows.length} tone="primary" />
            <StatCard label="Selected" value={checked.size} tone="info" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium">{data.job.title}</span>
              {data.job.location && (
                <span className="text-xs text-muted-foreground">{data.job.location}</span>
              )}
              <ChipList items={data.job.skillsRequired.slice(0, 6)} max={6} />
            </div>
            <Button
              size="sm"
              disabled={checked.size === 0 || sendToScreening.isPending}
              onClick={() =>
                sendToScreening.mutate(
                  { candidateIds: [...checked], jdId },
                  { onSuccess: () => setChecked(new Set()) },
                )
              }
            >
              {sendToScreening.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Send {checked.size || ""} to HR screening
            </Button>
          </div>

          {sendToScreening.isSuccess && (
            <p className="text-xs text-success">
              Queued {sendToScreening.data.queued} candidate(s) for HR screening
              {sendToScreening.data.alreadyQueued > 0 &&
                ` · ${sendToScreening.data.alreadyQueued} were already in the queue`}
              .
            </p>
          )}

          <TableShell>
            <thead>
              <tr>
                <Th className="w-10">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={() =>
                      setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.candidateId)))
                    }
                    className="size-3.5 accent-[#ff6b2b]"
                  />
                </Th>
                <Th>Candidate</Th>
                <Th>NIC / Phone</Th>
                <Th>Experience</Th>
                <Th>Match</Th>
                <Th>Matched skills</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.candidateId}>
                  <Td>
                    <input
                      type="checkbox"
                      checked={checked.has(row.candidateId)}
                      onChange={() => toggle(row.candidateId)}
                      className="size-3.5 accent-[#ff6b2b]"
                    />
                  </Td>
                  <Td>
                    <Link href={`/candidates/${row.candidateId}`} className="block hover:text-primary">
                      <span className="font-medium">{row.name}</span>
                      {row.headline && (
                        <span className="block text-[11px] text-muted-foreground">{row.headline}</span>
                      )}
                    </Link>
                    {isBucket(row.bucket) && (
                      <span
                        className={cn(
                          "mt-1 inline-block rounded border px-1.5 py-0.5 text-[10px]",
                          BUCKET_CLASS[row.bucket],
                        )}
                      >
                        {titleCase(row.bucket)}
                      </span>
                    )}
                  </Td>
                  <Td className="num text-[11px] text-muted-foreground">
                    {row.nic ?? "—"}
                    <span className="block">{row.phone ?? ""}</span>
                  </Td>
                  <Td className="num">{row.experienceYears != null ? `${row.experienceYears} yrs` : "—"}</Td>
                  <Td>
                    <ScorePill score={row.score} />
                  </Td>
                  <Td>
                    <ChipList items={row.skillsMatched} max={4} tone="matched" />
                  </Td>
                  <Td>
                    {/* Always the candidate's real pipeline status — a past HR
                        screening record must never mask a later placement. */}
                    <StatusBadge status={row.status} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </>
      )}
    </div>
  );
}

function CvToJd() {
  const [query, setQuery] = useState("");
  const [candidateId, setCandidateId] = useState<string | null>(null);

  const { data: candidates, isLoading } = useCandidateOptions(query);
  const { data, isFetching } = useJdsForCandidate(candidateId);

  const options = (candidates ?? []).map((c) => ({ ...c, id: c.id, label: c.label }));

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Candidate
        </p>
        <SearchSelect
          options={options}
          value={candidateId}
          onChange={setCandidateId}
          query={query}
          onQueryChange={setQuery}
          loading={isLoading}
          placeholder="Choose a candidate — search by name, NIC or phone number"
          renderOption={(option) => (
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{option.name}</span>
              <span className="ml-2 text-[11px] text-muted-foreground">
                {[option.nic, option.phone].filter(Boolean).join(" · ")}
              </span>
            </span>
          )}
        />
      </Card>

      {!candidateId && (
        <EmptyState
          icon={ArrowLeftRight}
          title="Pick a candidate"
          body="Search by name, NIC or phone number to see the job descriptions they match best."
        />
      )}

      {candidateId && isFetching && !data && (
        <Card className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Scoring open job descriptions…
        </Card>
      )}

      {candidateId && data && (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-display text-base font-semibold">{data.candidate.name}</p>
                <p className="text-[12px] text-muted-foreground">
                  {[data.candidate.headline, data.candidate.nic, data.candidate.phone]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Link href={`/candidates/${data.candidate.id}`}>
                <Button size="sm" variant="outline">
                  Open profile
                </Button>
              </Link>
            </div>
            <div className="mt-3">
              <ChipList items={data.candidate.skills.slice(0, 12)} max={12} />
            </div>
          </Card>

          <TableShell>
            <thead>
              <tr>
                <Th>Job description</Th>
                <Th>Client</Th>
                <Th>Location</Th>
                <Th>Match</Th>
                <Th>Matched skills</Th>
                <Th>Gaps</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <Tr key={row.jdId}>
                  <Td>
                    <Link href={`/jobs/${row.jdId}`} className="font-medium hover:text-primary">
                      {row.title}
                    </Link>
                  </Td>
                  <Td className="text-muted-foreground">{row.clientName ?? "—"}</Td>
                  <Td className="text-muted-foreground">{row.location ?? "—"}</Td>
                  <Td>
                    <ScorePill score={row.score} />
                  </Td>
                  <Td>
                    <ChipList items={row.skillsMatched} max={4} tone="matched" />
                  </Td>
                  <Td>
                    <ChipList items={row.skillsMissing} max={3} tone="missing" />
                  </Td>
                  <Td>
                    <StatusBadge status={row.status} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </>
      )}
    </div>
  );
}

export default function MatrixPage() {
  const [tab, setTab] = useState<Tab>("jd");

  return (
    <div>
      <PageHeader
        eyebrow="Matching"
        title="JD CV Matrix"
        subtitle="Score in both directions: the best candidates for a job, or the best jobs for a candidate."
      />

      <div className="mb-5 inline-flex rounded-lg border border-border bg-[#141414] p-1">
        {(
          [
            { key: "jd", label: "JD → CV" },
            { key: "cv", label: "CV → JD" },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              "rounded-md px-4 py-1.5 text-[13px] font-medium transition-colors",
              tab === item.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "jd" ? <JdToCv /> : <CvToJd />}
    </div>
  );
}
