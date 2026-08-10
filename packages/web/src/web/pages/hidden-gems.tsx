import { useState } from "react";
import { Link } from "wouter";
import { Gem, Mic, ShieldCheck, UserX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard, TableShell, Td, Th, Tr, ChipList } from "@/components/ui/page";
import { ScorePill } from "@/components/ui/score";
import { EmptyState, LoadingBlock } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { BUCKET_CLASS, isBucket, titleCase } from "@/lib/labels";
import { useHiddenGems } from "@/queries/talent";

/**
 * Hidden Gems — strong candidates lost at a single stage, so they can be
 * re-approached for the next suitable role instead of disappearing.
 */

type TabKey = "aiPassed" | "techPassed" | "clientFailed";

const TABS: { key: TabKey; label: string; hint: string }[] = [
  {
    key: "aiPassed",
    label: "AI interview passed",
    hint: "Cleared the AI interview above the match threshold but did not clear the technical round.",
  },
  {
    key: "techPassed",
    label: "Technical passed",
    hint: "Scored above the technical bar and is still unplaced.",
  },
  {
    key: "clientFailed",
    label: "Client interview failed",
    hint: "Strong technically, rejected by the client. Removed from the system after repeated failures.",
  },
];

export default function HiddenGemsPage() {
  const { data, isLoading } = useHiddenGems();
  const [tab, setTab] = useState<TabKey | null>(null);

  /* Open on the first tab that actually has candidates. */
  const activeTab: TabKey =
    tab ?? (TABS.find((t) => (data?.[t.key].length ?? 0) > 0)?.key ?? "aiPassed");
  const rows = data?.[activeTab] ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Talent pool"
        title="Hidden Gems"
        subtitle="Candidates who cleared one stage and fell at the next — worth a call when the right role opens."
      />

      {isLoading && <LoadingBlock rows={5} />}

      {!isLoading && data && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total hidden gems" value={data.total} icon={Gem} tone="primary" />
            <StatCard label="AI interview passed" value={data.aiPassed.length} icon={Mic} tone="info" />
            <StatCard label="Technical passed" value={data.techPassed.length} icon={ShieldCheck} tone="success" />
            <StatCard label="Client rejected" value={data.clientFailed.length} icon={UserX} tone="warning" />
          </div>

          <Card className="mb-5 p-3">
            <p className="text-[12px] text-muted-foreground">
              Blue tag: AI interview passed above{" "}
              <span className="num text-foreground">{data.thresholds.blueTagMinAiMatch}%</span> match. Purple
              tag: technical above{" "}
              <span className="num text-foreground">{data.thresholds.purpleTagMinTechScore}/100</span>.
              Candidates are removed from the active system after{" "}
              <span className="num text-foreground">{data.thresholds.clientFailLimit}</span> failed client
              interviews.
            </p>
          </Card>

          <div className="mb-4 flex flex-wrap gap-1.5 rounded-lg border border-border bg-[#141414] p-1">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={cn(
                  "rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                  activeTab === item.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                <span className="num ml-2 opacity-70">{data[item.key].length}</span>
              </button>
            ))}
          </div>

          <p className="mb-4 text-[12px] text-muted-foreground">
            {TABS.find((t) => t.key === activeTab)?.hint}
          </p>

          {rows.length === 0 ? (
            <EmptyState icon={Gem} title="Nothing in this tab yet" body="Candidates land here automatically as interviews are scored." />
          ) : (
            <TableShell>
              <thead>
                <tr>
                  <Th>Candidate</Th>
                  <Th>NIC / Phone</Th>
                  <Th>Experience</Th>
                  <Th>Match</Th>
                  <Th>Technical</Th>
                  <Th>Tag</Th>
                  <Th>Why they are here</Th>
                  <Th>Skills</Th>
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
                    <Td className="num">{row.experienceYears != null ? `${row.experienceYears} yrs` : "—"}</Td>
                    <Td>
                      <ScorePill score={row.matchScore} />
                    </Td>
                    <Td>
                      <ScorePill score={row.techScore} />
                    </Td>
                    <Td>
                      {isBucket(row.tag) ? (
                        <span
                          className={cn(
                            "inline-block rounded border px-1.5 py-0.5 text-[10px]",
                            BUCKET_CLASS[row.tag],
                          )}
                        >
                          {titleCase(row.tag)}
                        </span>
                      ) : (
                        <Badge tone="muted">{titleCase(row.tag)}</Badge>
                      )}
                    </Td>
                    <Td className="max-w-[280px] text-[12px] text-muted-foreground">{row.reason}</Td>
                    <Td>
                      <ChipList items={row.skills} max={4} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </>
      )}
    </div>
  );
}
