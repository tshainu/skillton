import { useState } from "react";
import { Link } from "wouter";
import { Cpu, RefreshCw, TimerOff, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, SectionTitle } from "../components/ui/card";
import { PageHeader, StatCard, TableShell, Td, Th, Tr } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Field, Input } from "../components/ui/field";
import { EmptyState, LoadingBlock, Spinner } from "../components/ui/feedback";
import { ScorePill } from "../components/ui/score";
import { Tabs } from "../components/ui/modal";
import { useExpiryOverview, useRerunExpired, useRerunMatch } from "../queries/matching";
import { useSettings, useUpdateSettings } from "../queries/insights";

/**
 * Operations — the home for periodic housekeeping tasks that keep the workspace
 * accurate. Tabs are intentionally structured so more routines (bulk re-parse,
 * duplicate merge, stale-candidate review) can be added alongside re-matching.
 */
type Tab = "rematch";

export default function OperationsPage() {
  const [tab, setTab] = useState<Tab>("rematch");
  const overview = useExpiryOverview();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const rerun = useRerunMatch();
  const rerunExpired = useRerunExpired();

  const expiryDays = settings.data?.values.scoreExpiryDays ?? 60;
  const expired = overview.data?.expired ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Maintenance"
        title="Operations"
        subtitle="Routine upkeep for your workspace. Re-run match scores that have aged out so rankings and search stay accurate."
        actions={
          expired > 0 ? (
            <Button
              onClick={() => rerunExpired.mutate({ limit: 100 })}
              disabled={rerunExpired.isPending}
              className="glow-primary"
            >
              {rerunExpired.isPending ? <Spinner /> : <RefreshCw className="size-4" />}
              Re-run all {expired}
            </Button>
          ) : undefined
        }
      />

      <Tabs
        className="rise rise-2 mb-4 w-fit"
        value={tab}
        onChange={setTab}
        tabs={[{ value: "rematch", label: "Re-matching", count: expired || undefined }]}
      />

      {tab === "rematch" && (
        <div className="rise rise-3 space-y-5">
          {overview.isLoading && <LoadingBlock rows={3} />}

          {overview.data && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Total match records" value={overview.data.total} icon={Cpu} tone="info" />
              <StatCard
                label="Live scores"
                value={overview.data.live}
                hint={`Threshold ${overview.data.threshold}`}
                icon={TrendingUp}
                tone="success"
              />
              <StatCard
                label="Expiring in 7 days"
                value={overview.data.expiringSoon}
                hint="Refresh before they drop out"
                icon={TimerOff}
                tone="warning"
              />
              <StatCard
                label="Needs re-matching"
                value={overview.data.expired}
                hint="Score withheld until re-run"
                icon={RefreshCw}
                tone={overview.data.expired > 0 ? "danger" : "info"}
              />
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
            <div>
              <SectionTitle
                title="Match records"
                hint="Sorted by expiry date. Candidates always stay visible — only the aged-out number is withheld."
              />
              {overview.data?.rows.length === 0 && (
                <EmptyState
                  icon={Cpu}
                  title="No match records yet"
                  body="Run the matching engine against a job description first."
                />
              )}
              {(overview.data?.rows.length ?? 0) > 0 && (
                <TableShell>
                  <thead>
                    <tr>
                      <Th>Candidate</Th>
                      <Th>Job description</Th>
                      <Th className="w-28">Score</Th>
                      <Th className="w-32">Matched</Th>
                      <Th className="w-36">Expiry</Th>
                      <Th className="w-28" />
                    </tr>
                  </thead>
                  <tbody>
                    {(overview.data?.rows ?? []).map((row) => (
                      <Tr key={row.matchId}>
                        <Td>
                          <Link
                            to={`/candidates/${row.candidateId}`}
                            className={
                              row.expired
                                ? "text-muted-foreground hover:text-foreground"
                                : "font-medium hover:text-primary-light"
                            }
                          >
                            {row.candidateName}
                          </Link>
                        </Td>
                        <Td>
                          <Link to={`/jobs/${row.jdId}`} className="text-muted-foreground hover:text-foreground">
                            {row.jobTitle}
                          </Link>
                        </Td>
                        <Td>
                          <ScorePill score={row.score} />
                        </Td>
                        <Td className="num text-[11.5px] text-muted-foreground">
                          {new Date(row.matchedAt).toLocaleDateString()}
                        </Td>
                        <Td>
                          {row.expired ? (
                            <Badge tone="warning">re-match</Badge>
                          ) : (
                            <span className="num text-[11.5px] text-muted-foreground">
                              {row.daysLeft}d · {new Date(row.expiresAt).toLocaleDateString()}
                            </span>
                          )}
                        </Td>
                        <Td>
                          <button
                            type="button"
                            onClick={() => rerun.mutate({ candidateId: row.candidateId, jdId: row.jdId })}
                            disabled={rerun.isPending}
                            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] transition-colors hover:border-primary/40 hover:text-primary"
                          >
                            <RefreshCw className={rerun.isPending ? "size-3 animate-spin" : "size-3"} /> Re-run
                          </button>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableShell>
              )}
            </div>

            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Refresh window</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3.5">
                <Field
                  label="Score lifetime (days)"
                  hint="How long a match score stays valid before it needs re-running."
                >
                  <Input
                    type="number"
                    min={1}
                    max={730}
                    defaultValue={expiryDays}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (value !== expiryDays) updateSettings.mutate({ scoreExpiryDays: value });
                    }}
                  />
                </Field>
                {updateSettings.isPending && <Spinner className="text-primary" />}
                <p className="border-t border-border pt-3 text-[12px] leading-relaxed text-muted-foreground">
                  Aged-out scores are left out of rankings and match search until re-run, so you never act on a stale
                  number.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
