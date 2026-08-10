import { useState } from "react";
import { Link } from "wouter";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarClock, Search, Trophy, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { PageHeader, StatCard, TableShell, Td, Th, Tr } from "../components/ui/page";
import { Badge, StatusBadge } from "../components/ui/badge";
import { Input, Select } from "../components/ui/field";
import { EmptyState, LoadingBlock, Spinner } from "../components/ui/feedback";
import { ScorePill } from "../components/ui/score";
import { usePlacements, usePlacementStats, useUpdatePlacement } from "../queries/insights";

const PIE_COLORS = ["#ff6b2b", "#3b82f6", "#10b981", "#f59e0b", "#a855f7", "#ef4444"];
const AXIS = { stroke: "#5f5f5f", fontSize: 11, fontFamily: "JetBrains Mono" };

export default function PlacedPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const placements = usePlacements({ search: search.length > 1 ? search : undefined, status: status || undefined });
  const stats = usePlacementStats();
  const update = useUpdatePlacement();

  const rows = placements.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Outcomes"
        title="Placed"
        subtitle="Every hire, permanently recorded — candidate, client, role, salary, scores at hire, recruiter credit and time-to-hire. These records survive data retention cleanup."
      />

      {stats.isLoading && <LoadingBlock rows={2} />}

      {stats.data && (
        <div className="rise rise-2 mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Total placements"
            value={stats.data.total}
            hint={`${stats.data.activeCount} currently active`}
            icon={Trophy}
            tone="success"
          />
          <StatCard label="This month" value={stats.data.thisMonth} icon={CalendarClock} tone="primary" />
          <StatCard
            label="Avg time to hire"
            value={stats.data.avgTimeToHire != null ? `${stats.data.avgTimeToHire}d` : "—"}
            icon={CalendarClock}
            tone="info"
          />
          <StatCard
            label="Avg final score"
            value={stats.data.avgFinalScore ?? "—"}
            hint="match × 0.20 + tech × 0.80"
            icon={Users}
            tone="warning"
          />
        </div>
      )}

      {stats.data && stats.data.total > 0 && (
        <div className="rise rise-3 mb-5 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Placements by month</CardTitle>
                <p className="text-[12px] text-muted-foreground">Rolling 12 months</p>
              </div>
            </CardHeader>
            <CardContent className="h-[230px] pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.data.byMonth}>
                  <CartesianGrid stroke="#1f1f1f" vertical={false} />
                  <XAxis dataKey="month" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "#141414", border: "1px solid #2b2b2b", borderRadius: 10, fontSize: 12 }}
                  />
                  <Bar dataKey="placements" fill="#ff6b2b" radius={[4, 4, 0, 0]} name="Placements" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>By client</CardTitle>
            </CardHeader>
            <CardContent className="h-[230px] pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.data.byClient}
                    dataKey="count"
                    nameKey="name"
                    innerRadius="52%"
                    outerRadius="80%"
                    paddingAngle={3}
                    stroke="none"
                  >
                    {stats.data.byClient.map((entry, i) => (
                      <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#141414", border: "1px solid #2b2b2b", borderRadius: 10, fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="rise rise-3 mb-4 flex flex-wrap items-end gap-3 p-3.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidate, role or client"
            className="pl-9"
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-[180px]">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="probation">Probation</option>
          <option value="completed">Completed</option>
          <option value="left">Left</option>
        </Select>
        {placements.isFetching && <Spinner className="text-muted-foreground" />}
      </Card>

      {placements.isLoading && <LoadingBlock rows={5} />}

      {!placements.isLoading && rows.length === 0 && (
        <EmptyState
          icon={Trophy}
          title="No placements yet"
          body="Mark a candidate as hired from their profile — that creates the permanent placement record shown here."
          action={
            <Link
              to="/candidates"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Open candidates
            </Link>
          }
        />
      )}

      {rows.length > 0 && (
        <TableShell className="rise rise-4">
          <thead>
            <tr>
              <Th>Candidate</Th>
              <Th>Role & client</Th>
              <Th className="w-40">Salary</Th>
              <Th className="w-32">Scores</Th>
              <Th className="w-28">Time to hire</Th>
              <Th className="w-36">Recruiter</Th>
              <Th className="w-36">Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <Tr key={p.id}>
                <Td>
                  <Link to={`/candidates/${p.candidateId}`} className="block max-w-[220px]">
                    <p className="truncate font-medium hover:text-primary-light">{p.candidateName}</p>
                    {p.candidateEmail && (
                      <p className="truncate text-[11.5px] text-muted-foreground">{p.candidateEmail}</p>
                    )}
                  </Link>
                </Td>
                <Td>
                  <p className="truncate font-medium">{p.positionTitle}</p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {[p.clientName, p.department, p.location].filter(Boolean).join(" · ")}
                  </p>
                </Td>
                <Td>
                  <p className="num text-[12.5px]">{p.offeredSalary ?? "—"}</p>
                  <p className="num text-[11px] text-muted-foreground">
                    placed {new Date(p.placedAt).toLocaleDateString()}
                  </p>
                </Td>
                <Td>
                  <div className="flex flex-col gap-1">
                    <ScorePill score={p.finalScore} />
                    <span className="num text-[10px] text-muted-foreground">
                      m {p.matchScoreAtHire?.toFixed(0) ?? "—"} · t {p.techScoreAtHire?.toFixed(0) ?? "—"}
                    </span>
                  </div>
                </Td>
                <Td className="num">{p.timeToHireDays != null ? `${p.timeToHireDays}d` : "—"}</Td>
                <Td>
                  <span className="truncate text-[12.5px]">{p.recruiterName ?? "—"}</span>
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={p.status} />
                    <select
                      value={p.status}
                      onChange={(e) =>
                        update.mutate({
                          id: p.id,
                          status: e.target.value as "active" | "probation" | "completed" | "left",
                        })
                      }
                      className="h-7 cursor-pointer rounded-md border border-border bg-[#141414] px-1.5 text-[11px] outline-none"
                    >
                      <option value="active">Active</option>
                      <option value="probation">Probation</option>
                      <option value="completed">Completed</option>
                      <option value="left">Left</option>
                    </select>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}

      {rows.some((p) => p.notes) && (
        <div className="rise rise-5 mt-5 grid gap-3 lg:grid-cols-2">
          {rows
            .filter((p) => p.notes)
            .slice(0, 6)
            .map((p) => (
              <Card key={p.id} className="p-4">
                <div className="flex items-center gap-2">
                  <Badge tone="success">{p.candidateName}</Badge>
                  <span className="text-[11.5px] text-muted-foreground">{p.positionTitle}</span>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{p.notes}</p>
              </Card>
            ))}
        </div>
      )}
    </>
  );
}
