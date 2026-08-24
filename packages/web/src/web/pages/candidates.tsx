import { useRef, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  Columns3,
  FileUp,
  Search,
  ShieldBan,
  TimerOff,
  Trash2,
  Undo2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { Card } from "../components/ui/card";
import { ChipList, PageHeader, StatCard, TableShell, Td, Th, Tr } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Badge, StatusBadge } from "../components/ui/badge";
import { Input, Select } from "../components/ui/field";
import { EmptyState, ErrorNote, LoadingBlock, Spinner } from "../components/ui/feedback";
import { Modal } from "../components/ui/modal";
import { Popover } from "../components/ui/popover";
import { useConfirm, useToast } from "../components/ui/toast";
import { ScorePill } from "../components/ui/score";
import {
  uploadFile,
  useBulkUpload,
  useCandidates,
  useDeleteCandidate,
  useParseCandidate,
} from "../queries/candidates";
import { useRerunExpired } from "../queries/matching";
import { useSetBlacklisted } from "../queries/talent";
import { cn } from "../lib/utils";
import { BUCKET_CLASS, isBucket, SOURCE_LABEL, titleCase } from "../lib/labels";
import { CANDIDATE_STATUSES } from "../lib/candidate-status";
import { coreSkills } from "../lib/skill-class";

interface UploadItem {
  filename: string;
  state: "uploading" | "parsing" | "done" | "error" | "duplicate";
  detail?: string;
}

/** Toggleable columns — each one can be hidden independently. */
const COLUMNS = [
  { key: "candidate", label: "Candidate", locked: true },
  { key: "phone", label: "Phone" },
  { key: "source", label: "Source" },
  { key: "bucket", label: "Bucket" },
  { key: "skills", label: "Skills" },
  { key: "experience", label: "Experience" },
  { key: "score", label: "Best score" },
  { key: "status", label: "Status" },
  { key: "actions", label: "Actions", locked: true },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];

/**
 * Built from the API's own enum: "" is the "all statuses" placeholder, every
 * other entry is a value the server will accept. Hand-maintaining this list is
 * what put a non-existent "interviewing" in the dropdown and made the filter
 * return HTTP 400 instead of candidates.
 */
const STATUS_OPTIONS = ["", ...CANDIDATE_STATUSES];

export default function CandidatesPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [skill, setSkill] = useState("");
  const [minExp, setMinExp] = useState("");
  const [tab, setTab] = useState<"active" | "blacklisted">("active");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsAnchor = useRef<HTMLDivElement | null>(null);
  const [hidden, setHidden] = useState<Set<ColumnKey>>(new Set(["phone", "source"]));
  const [blacklisting, setBlacklisting] = useState<{ id: string; name: string } | null>(null);
  const [blacklistReason, setBlacklistReason] = useState("");

  const show = (key: ColumnKey) => !hidden.has(key);
  function toggleColumn(key: ColumnKey) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const candidates = useCandidates({
    search: search.length > 1 ? search : undefined,
    status: status || undefined,
    skill: skill.length > 1 ? skill : undefined,
    minExperience: minExp ? Number(minExp) : undefined,
    scope: tab,
  });
  const setBlacklisted = useSetBlacklisted();
  const bulkUpload = useBulkUpload();
  const parse = useParseCandidate();
  const remove = useDeleteCandidate();
  const rerunExpired = useRerunExpired();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = items.some((i) => i.state === "uploading" || i.state === "parsing");

  const rows = candidates.data ?? [];
  const expiredCount = rows.filter((r) => r.scoreExpired).length;
  const unparsed = rows.filter((r) => r.parseStatus !== "parsed").length;

  async function handleFiles(files: FileList) {
    setError(null);
    const list = Array.from(files).slice(0, 50);
    setItems(list.map((f) => ({ filename: f.name, state: "uploading" as const })));

    const uploaded: { key: string; filename: string }[] = [];
    for (const [index, file] of list.entries()) {
      try {
        const result = await uploadFile(file, "cv");
        uploaded.push(result);
        setItems((prev) => prev.map((it, i) => (i === index ? { ...it, state: "parsing" } : it)));
      } catch (e) {
        setItems((prev) =>
          prev.map((it, i) => (i === index ? { ...it, state: "error", detail: (e as Error).message } : it)),
        );
      }
    }

    if (uploaded.length === 0) return;

    try {
      const { ids } = await bulkUpload.mutateAsync({ files: uploaded });
      /* Parse sequentially so progress is visible per CV. */
      for (const [index, id] of ids.entries()) {
        try {
          const result = await parse.mutateAsync({ id });
          setItems((prev) =>
            prev.map((it, i) =>
              i === index
                ? {
                    ...it,
                    state: result.isDuplicateOf
                      ? "duplicate"
                      : result.parseStatus === "parsed"
                        ? "done"
                        : "error",
                    detail: result.isDuplicateOf
                      ? "Duplicate of an existing candidate"
                      : (result.parseError ??
                        `${result.firstName} ${result.lastName ?? ""}`.trim()),
                  }
                : it,
            ),
          );
        } catch (e) {
          setItems((prev) =>
            prev.map((it, i) => (i === index ? { ...it, state: "error", detail: (e as Error).message } : it)),
          );
        }
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Sourcing"
        title="Candidate library"
        subtitle="Every CV is parsed into structured data — skills, technologies, experience, education and certifications — then embedded for semantic matching."
        actions={
          /* The blacklist is a record of people we are not working with — it is
             listing-only, so neither uploading nor re-scoring belongs on it. */
          tab === "blacklisted" ? null : (
            <>
              {expiredCount > 0 && (
                <Button variant="outline" onClick={() => rerunExpired.mutate({ limit: 100 })} disabled={rerunExpired.isPending}>
                  {rerunExpired.isPending ? <Spinner /> : <TimerOff className="size-4" />}
                  Re-run {expiredCount} expired
                </Button>
              )}
              <Button
                onClick={() => {
                  setItems([]);
                  setUploadOpen(true);
                }}
                className="glow-primary"
              >
                <Upload className="size-4" /> Bulk upload CVs
              </Button>
            </>
          )
        }
      />

      <div className="rise rise-2 mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Candidates" value={rows.length} icon={Users} tone="primary" />
        <StatCard
          label="Shortlisted"
          value={rows.filter((r) => r.currentStatus === "shortlisted").length}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard label="Expired scores" value={expiredCount} hint="Score hidden until re-run" icon={TimerOff} tone="warning" />
        <StatCard
          label="Awaiting parse"
          value={unparsed}
          hint="Not eligible for matching yet"
          icon={AlertTriangle}
          tone={unparsed > 0 ? "danger" : "info"}
        />
      </div>

      {/* Active / blacklisted tabs */}
      <div className="rise rise-2 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-[#141414] p-1">
          {(
            [
              { key: "active", label: "Active candidates" },
              { key: "blacklisted", label: "Blacklisted" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={cn(
                "rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                tab === item.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Per-column visibility toggles */}
        <div ref={columnsAnchor} className="relative">
          <Button variant="outline" size="sm" onClick={() => setColumnsOpen((v) => !v)}>
            <Columns3 className="size-4" />
            Columns
            <span className="num ml-1 text-muted-foreground">
              {COLUMNS.length - hidden.size}/{COLUMNS.length}
            </span>
          </Button>
          <Popover open={columnsOpen} onClose={() => setColumnsOpen(false)} anchorRef={columnsAnchor} width={224}>
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Arrange columns
            </p>
            {COLUMNS.map((column) => (
              <label
                key={column.key}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-white/[0.04]",
                  column.locked && "cursor-not-allowed opacity-50",
                )}
              >
                <input
                  type="checkbox"
                  disabled={column.locked}
                  checked={show(column.key)}
                  onChange={() => toggleColumn(column.key)}
                  className="size-3.5 accent-[#ff6b2b]"
                />
                {column.label}
              </label>
            ))}
          </Popover>
        </div>
      </div>

      {/* Filters */}
      <Card className="rise rise-2 mb-4 flex flex-wrap items-end gap-3 p-3.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, email, headline or CV text"
            className="pl-9"
          />
        </div>
        <Input
          value={skill}
          onChange={(e) => setSkill(e.target.value)}
          placeholder="Skill or technology"
          className="w-[180px]"
        />
        <Input
          type="number"
          min={0}
          value={minExp}
          onChange={(e) => setMinExp(e.target.value)}
          placeholder="Min yrs"
          className="w-[100px]"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-[190px]">
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s ? titleCase(s) : "All statuses"}
            </option>
          ))}
        </Select>
        {(search || skill || status || minExp) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setSkill("");
              setStatus("");
              setMinExp("");
            }}
          >
            <X className="size-3.5" /> Clear
          </Button>
        )}
        {candidates.isFetching && <Spinner className="text-muted-foreground" />}
      </Card>

      {candidates.isLoading && <LoadingBlock rows={6} />}

      {!candidates.isLoading && rows.length === 0 && (
        <EmptyState
          icon={Users}
          title={tab === "blacklisted" ? "No blacklisted candidates" : "No candidates match"}
          body={
            tab === "blacklisted"
              ? "Candidates you blacklist appear here as a read-only list."
              : "Upload a batch of CVs (PDF, DOCX or ZIP entries) — Skillton parses each one and detects duplicates automatically."
          }
          action={
            tab === "blacklisted" ? null : (
              <Button
                onClick={() => {
                  setItems([]);
                  setUploadOpen(true);
                }}
              >
                <Upload className="size-4" /> Bulk upload CVs
              </Button>
            )
          }
        />
      )}

      {rows.length > 0 && (
        <TableShell className="rise rise-3">
          <thead>
            <tr>
              <Th>Candidate</Th>
              {show("phone") && <Th className="w-36">Phone</Th>}
              {show("source") && <Th className="w-32">Source</Th>}
              {show("bucket") && <Th className="w-28">Bucket</Th>}
              {show("skills") && <Th>Skills</Th>}
              {show("experience") && <Th className="w-24">Exp</Th>}
              {show("score") && <Th className="w-32">Best score</Th>}
              {show("status") && <Th className="w-44">Status</Th>}
              <Th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <Link to={`/candidates/${c.id}`} className="block max-w-[260px]">
                    <p className="truncate font-medium hover:text-primary-light">
                      {c.firstName} {c.lastName}
                    </p>
                    <p className="truncate text-[11.5px] text-muted-foreground">
                      {c.headline ?? c.email ?? c.cvFileName}
                    </p>
                  </Link>
                  {c.isDuplicateOf && (
                    <Badge tone="warning" className="mt-1">
                      duplicate
                    </Badge>
                  )}
                  {c.parseStatus !== "parsed" && (
                    <Badge tone={c.parseStatus === "failed" ? "danger" : "muted"} className="mt-1">
                      {c.parseStatus}
                    </Badge>
                  )}
                </Td>
                {show("phone") && <Td className="num text-[12px]">{c.phone ?? "—"}</Td>}
                {show("source") && (
                  <Td className="text-[12px] text-muted-foreground">
                    {SOURCE_LABEL[c.source] ?? titleCase(c.source)}
                  </Td>
                )}
                {show("bucket") && (
                  <Td>
                    {isBucket(c.bucket) ? (
                      <span
                        className={cn(
                          "inline-block rounded border px-1.5 py-0.5 text-[10px]",
                          BUCKET_CLASS[c.bucket],
                        )}
                        title={c.bucketReason ?? undefined}
                      >
                        {titleCase(c.bucket)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Td>
                )}
                {show("skills") && (
                  <Td>
                    <div className="max-w-[280px]">
                      <ChipList items={coreSkills(c.skillsExtracted)} max={4} />
                    </div>
                  </Td>
                )}
                {show("experience") && (
                  <Td className="num">{c.experienceYears != null ? `${c.experienceYears}y` : "—"}</Td>
                )}
                {show("score") && (
                <Td>
                  {c.scoreExpired ? (
                    <span className="flex items-center gap-1 text-[11.5px] text-warning">
                      <TimerOff className="size-3" /> expired
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <ScorePill score={c.bestScore} />
                      {c.matchCount > 0 && (
                        <span className="num text-[10px] text-muted-foreground">{c.matchCount} jd</span>
                      )}
                    </div>
                  )}
                </Td>
                )}
                {show("status") && (
                  <Td>
                    <StatusBadge status={c.currentStatus} />
                    {c.isBlacklisted && c.blacklistReason && (
                      <span className="mt-1 block text-[10px] text-destructive">{c.blacklistReason}</span>
                    )}
                  </Td>
                )}
                <Td>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      title={c.isBlacklisted ? "Restore candidate" : "Blacklist candidate"}
                      onClick={() => {
                        if (c.isBlacklisted) {
                          setBlacklisted.mutate({ candidateId: c.id, blacklisted: false });
                        } else {
                          setBlacklisting({ id: c.id, name: `${c.firstName} ${c.lastName ?? ""}`.trim() });
                          setBlacklistReason("");
                        }
                      }}
                      className={cn(
                        "grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors",
                        c.isBlacklisted
                          ? "hover:border-success/40 hover:text-success"
                          : "hover:border-warning/40 hover:text-warning",
                      )}
                    >
                      {c.isBlacklisted ? <Undo2 className="size-3.5" /> : <ShieldBan className="size-3.5" />}
                    </button>
                    <button
                      type="button"
                      title="Delete candidate"
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Delete ${c.firstName} ${c.lastName ?? ""}?`,
                          description: "Every related match, interview and note is removed.",
                          confirmLabel: "Delete candidate",
                          tone: "danger",
                        });
                        if (!ok) return;
                        remove.mutate(
                          { id: c.id },
                          {
                            onSuccess: () => toast({ tone: "success", title: "Candidate deleted" }),
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
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <Modal
        open={Boolean(blacklisting)}
        onClose={() => setBlacklisting(null)}
        title={blacklisting ? `Blacklist ${blacklisting.name}` : ""}
        description="Blacklisted candidates are excluded from matching, screening and every interview queue. You can restore them at any time."
      >
        <div className="space-y-4">
          <Input
            value={blacklistReason}
            onChange={(e) => setBlacklistReason(e.target.value)}
            placeholder="Reason (required) — e.g. falsified experience"
          />
          <div className="flex flex-wrap gap-1.5">
            {["Falsified CV details", "No-show at interview", "Unprofessional conduct", "Declined offer twice"].map(
              (reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setBlacklistReason(reason)}
                  className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {reason}
                </button>
              ),
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBlacklisting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!blacklistReason.trim() || setBlacklisted.isPending}
              onClick={() =>
                blacklisting &&
                setBlacklisted.mutate(
                  { candidateId: blacklisting.id, blacklisted: true, reason: blacklistReason.trim() },
                  { onSuccess: () => setBlacklisting(null) },
                )
              }
            >
              {setBlacklisted.isPending && <Spinner />}
              Blacklist candidate
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={uploadOpen}
        onClose={() => !busy && setUploadOpen(false)}
        title="Bulk upload CVs"
        description="Up to 50 files per batch. Each CV is uploaded to storage, parsed by AI into structured fields, then embedded for matching."
        width="max-w-xl"
        footer={
          <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? "Processing…" : "Done"}
          </Button>
        }
      >
        <div className="space-y-4">
          {error && <ErrorNote message={error} />}

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-8 transition-colors hover:border-primary/50 disabled:opacity-60"
          >
            <FileUp className="size-6 text-primary" />
            <span className="text-[13.5px] font-medium">Choose CV files</span>
            <span className="text-[12px] text-muted-foreground">PDF, DOCX or TXT · up to 50 at once</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.txt"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void handleFiles(e.target.files);
            }}
          />

          {items.length > 0 && (
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {items.map((item, i) => (
                <div
                  key={`${item.filename}-${i}`}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-white/[0.02] px-3 py-2"
                >
                  {item.state === "uploading" || item.state === "parsing" ? (
                    <Spinner className="text-primary" />
                  ) : item.state === "done" ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : item.state === "duplicate" ? (
                    <AlertTriangle className="size-4 text-warning" />
                  ) : (
                    <X className="size-4 text-destructive" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px]">{item.filename}</p>
                    {item.detail && <p className="truncate text-[11px] text-muted-foreground">{item.detail}</p>}
                  </div>
                  <span className="text-[11px] capitalize text-muted-foreground">{item.state}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
