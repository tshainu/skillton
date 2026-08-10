import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Briefcase, Search, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCandidates } from "../../queries/candidates";
import { useJobs } from "../../queries/jobs";
import { NAV } from "./nav";
import { Spinner } from "../ui/feedback";
import { ScorePill } from "../ui/score";

/** ⌘K search across pages, candidates and jobs. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [, navigate] = useLocation();
  const candidates = useCandidates({ search: query.length > 1 ? query : undefined });
  const jobs = useJobs();

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const pages = useMemo(
    () =>
      NAV.flatMap((g) => g.items).filter((item) =>
        query ? item.label.toLowerCase().includes(query.toLowerCase()) : true,
      ),
    [query],
  );

  const jobHits = useMemo(
    () =>
      (jobs.data ?? [])
        .filter((j) => (query ? j.title.toLowerCase().includes(query.toLowerCase()) : true))
        .slice(0, 5),
    [jobs.data, query],
  );

  const candidateHits = (candidates.data ?? []).slice(0, 6);

  if (!open) return null;

  const go = (href: string) => {
    navigate(href);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <button type="button" aria-label="Close" className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="glass animate-in fade-in zoom-in-95 relative z-10 w-full max-w-xl overflow-hidden rounded-2xl shadow-2xl duration-150">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search candidates, jobs or jump to a page…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-[#6b6b6b]"
          />
          {candidates.isFetching && <Spinner className="text-muted-foreground" />}
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {pages.length > 0 && (
            <Group label="Pages">
              {pages.map((item) => (
                <Row key={item.href} onClick={() => go(item.href)} icon={<item.icon className="size-4" />}>
                  {item.label}
                </Row>
              ))}
            </Group>
          )}

          {candidateHits.length > 0 && (
            <Group label="Candidates">
              {candidateHits.map((c) => (
                <Row
                  key={c.id}
                  onClick={() => go(`/candidates/${c.id}`)}
                  icon={<User className="size-4" />}
                  right={c.scoreExpired ? <span className="text-[11px] text-warning">expired</span> : <ScorePill score={c.bestScore} />}
                >
                  <span className="truncate">
                    {c.firstName} {c.lastName}
                    <span className="ml-2 text-[11px] text-muted-foreground">{c.headline}</span>
                  </span>
                </Row>
              ))}
            </Group>
          )}

          {jobHits.length > 0 && (
            <Group label="Job descriptions">
              {jobHits.map((j) => (
                <Row
                  key={j.id}
                  onClick={() => go(`/jobs/${j.id}`)}
                  icon={<Briefcase className="size-4" />}
                  right={<ScorePill score={j.bestScore} />}
                >
                  <span className="truncate">
                    {j.title}
                    {j.clientName && <span className="ml-2 text-[11px] text-muted-foreground">{j.clientName}</span>}
                  </span>
                </Row>
              ))}
            </Group>
          )}

          {pages.length === 0 && candidateHits.length === 0 && jobHits.length === 0 && (
            <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">No results for "{query}".</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
        {label}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({
  children,
  icon,
  right,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  right?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground/85",
        "transition-colors hover:bg-white/[0.05] hover:text-foreground",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right}
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
