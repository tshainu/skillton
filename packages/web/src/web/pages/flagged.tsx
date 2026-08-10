import { useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Flag, Loader2, Trophy, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PageHeader, StatCard, TableShell, Td, Th, Tr } from "@/components/ui/page";
import { ScorePill } from "@/components/ui/score";
import { EmptyState, LoadingBlock } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { BUCKET_CLASS, formatDate, isBucket, titleCase } from "@/lib/labels";
import { useFlaggedCandidates, useSetClientOutcome } from "@/queries/talent";

/**
 * Flagged candidates — everyone selected at the technical stage, waiting on the
 * client's own interview decision. The action dropdown records Placed / Hold /
 * Rejected; repeated rejections eventually remove the candidate.
 */

const OUTCOMES = [
  { value: "placed", label: "Placed" },
  { value: "hold", label: "Hold" },
  { value: "rejected", label: "Rejected" },
] as const;

type Outcome = (typeof OUTCOMES)[number]["value"];

export default function FlaggedPage() {
  const { data, isLoading } = useFlaggedCandidates();
  const setOutcome = useSetClientOutcome();
  const [pending, setPending] = useState<{ id: string; name: string; outcome: Outcome } | null>(null);
  const [feedback, setFeedback] = useState("");

  const rows = data?.rows ?? [];
  const failLimit = data?.failLimit ?? 3;

  function submit() {
    if (!pending) return;
    setOutcome.mutate(
      { candidateId: pending.id, outcome: pending.outcome, feedback: feedback.trim() || undefined },
      {
        onSuccess: () => {
          setPending(null);
          setFeedback("");
        },
      },
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Interviews"
        title="Flagged Candidates"
        subtitle="Selected at the technical interview and waiting on the client-side decision."
      />

      {isLoading && <LoadingBlock rows={5} />}

      {!isLoading && rows.length === 0 && (
        <EmptyState
          icon={Flag}
          title="No flagged candidates"
          body="Candidates appear here the moment a technical interviewer marks them as selected."
        />
      )}

      {!isLoading && rows.length > 0 && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Awaiting decision" value={rows.length} icon={Flag} tone="primary" />
            <StatCard
              label="Placed"
              value={rows.filter((r) => r.clientOutcome === "placed").length}
              icon={Trophy}
              tone="success"
            />
            <StatCard
              label="On hold"
              value={rows.filter((r) => r.clientOutcome === "hold").length}
              icon={AlertTriangle}
              tone="warning"
            />
            <StatCard
              label={`At risk (${failLimit} fails removes)`}
              value={rows.filter((r) => r.clientFailCount >= failLimit - 1).length}
              icon={UserX}
              tone="danger"
            />
          </div>

          <TableShell>
            <thead>
              <tr>
                <Th>Candidate</Th>
                <Th>NIC / Phone</Th>
                <Th>Match</Th>
                <Th>AI interview</Th>
                <Th>Technical</Th>
                <Th>Final</Th>
                <Th>Tag</Th>
                <Th>Client fails</Th>
                <Th>Last outcome</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Link href={`/candidates/${row.id}`} className="block hover:text-primary">
                      <span className="font-medium">{row.name}</span>
                      {row.headline && (
                        <span className="block text-[11px] text-muted-foreground">{row.headline}</span>
                      )}
                    </Link>
                  </Td>
                  <Td className="num text-[11px] text-muted-foreground">
                    {row.nic ?? "—"}
                    <span className="block">{row.phone ?? ""}</span>
                  </Td>
                  <Td>
                    <ScorePill score={row.matchScore} />
                  </Td>
                  {/* The AI interview read: dimensions average out of 10, plus the
                      confidence signal proctoring picked up. */}
                  <Td>
                    {row.aiScore != null ? (
                      <span className="num text-[12.5px] font-medium">
                        {row.aiScore.toFixed(1)}
                        <span className="text-[10.5px] text-muted-foreground">/10</span>
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        {row.aiStatus === "pending" || row.aiStatus === "in_progress"
                          ? "Not sat yet"
                          : row.aiStatus === "terminated"
                            ? "Terminated"
                            : "—"}
                      </span>
                    )}
                    {row.aiConfident && (
                      <span className="mt-0.5 block text-[10px] text-success">Very confident</span>
                    )}
                    {row.aiFlags.length > 0 && (
                      <span className="mt-0.5 block text-[10px] text-warning">
                        {row.aiFlags.length} integrity flag{row.aiFlags.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <ScorePill score={row.techScore} />
                  </Td>
                  <Td>
                    <ScorePill score={row.finalScore} />
                  </Td>
                  <Td>
                    {isBucket(row.bucket) ? (
                      <span
                        className={cn(
                          "inline-block rounded border px-1.5 py-0.5 text-[10px]",
                          BUCKET_CLASS[row.bucket],
                        )}
                      >
                        {titleCase(row.bucket)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={row.clientFailCount >= failLimit - 1 ? "danger" : "muted"}>
                      {row.clientFailCount} / {failLimit}
                    </Badge>
                  </Td>
                  <Td className="text-[11px] text-muted-foreground">
                    {row.clientOutcome ? (
                      <>
                        <span className="block font-medium text-foreground/80">
                          {titleCase(row.clientOutcome)}
                        </span>
                        {formatDate(row.lastOutcomeAt)}
                      </>
                    ) : (
                      "Not yet interviewed"
                    )}
                  </Td>
                  <Td className="text-right">
                    <Select
                      value=""
                      className="ml-auto w-[130px]"
                      onChange={(e) => {
                        const value = e.target.value as Outcome;
                        if (!value) return;
                        setPending({ id: row.id, name: row.name, outcome: value });
                        setFeedback("");
                      }}
                    >
                      <option value="">Set outcome…</option>
                      {OUTCOMES.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </>
      )}

      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title={pending ? `Mark ${pending.name} as ${titleCase(pending.outcome)}` : ""}
        description="Record the client's decision. Rejections count towards the removal limit."
      >
        <div className="space-y-4">
          {pending?.outcome === "rejected" && (
            <p className="rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2 text-[12px] text-warning">
              A rejection increments this candidate's client-fail counter. At {failLimit} failures they are
              removed from the active system, and a strong technical score tags them purple as a hidden gem.
            </p>
          )}
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Client feedback (optional but recommended)"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={setOutcome.isPending}>
              {setOutcome.isPending && <Loader2 className="size-4 animate-spin" />}
              Save outcome
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
