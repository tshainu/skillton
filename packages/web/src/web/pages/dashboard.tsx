import { Link } from "wouter";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Briefcase,
  Building2,
  Cpu,
  Database,
  RefreshCw,
  Trophy,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, SectionTitle } from "../components/ui/card";
import { PageHeader, StatCard } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { EmptyState, LoadingBlock, StatSkeleton } from "../components/ui/feedback";
import { Meter, scoreColor } from "../components/ui/score";
import { useDashboard } from "../queries/insights";
import { useMe, useSeedDemo } from "../queries/session";

const AXIS = { stroke: "#5f5f5f", fontSize: 11, fontFamily: "JetBrains Mono" };

function ChartTooltip() {
  return (
    <Tooltip
      contentStyle={{
        background: "#141414",
        border: "1px solid #2b2b2b",
        borderRadius: 10,
        fontSize: 12,
        fontFamily: "Poppins",
      }}
      labelStyle={{ color: "#a3a3a3", fontSize: 11 }}
    />
  );
}

export default function DashboardPage() {
  const me = useMe();
  const dashboard = useDashboard();
  const seed = useSeedDemo();

  const data = dashboard.data;
  const agencyName = me.data && "agency" in me.data ? me.data.agency?.name : undefined;
  const firstName = me.data && "user" in me.data ? me.data.user.name.split(" ")[0] : "";

  const isEmpty = data && data.kpis.totalCandidates === 0 && data.kpis.openJobs === 0;

  return (
    <>
      <PageHeader
        eyebrow={agencyName ?? "Workspace"}
        title={`Good to see you, ${firstName}`}
        subtitle="Pipeline health, match quality and interview throughput across every open role."
        actions={
          <>
            <Link
              to="/matching"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              <Cpu className="size-4" /> Matching engine
            </Link>
          </>
        }
      />

      {dashboard.isLoading && (
        <div className="space-y-4">
          <StatSkeleton count={4} />
          <LoadingBlock rows={4} />
        </div>
      )}

      {isEmpty && (
        <EmptyState
          icon={Database}
          title="Your workspace is empty"
          body="Load a realistic demo agency — clients, job descriptions, parsed CVs, ranked matches, interviews and a placement — or start by adding your first client."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => seed.mutate({ force: false })} disabled={seed.isPending} className="glow-primary">
                {seed.isPending ? <RefreshCw className="size-4 animate-spin" /> : <Database className="size-4" />}
                Load demo data
              </Button>
              <Link
                to="/clients"
                className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:border-border-hover"
              >
                Add a client
              </Link>
            </div>
          }
        />
      )}

      {data && !isEmpty && (
        <div className="space-y-6">
          {/* KPI row */}
          <div className="rise rise-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Candidates"
              value={data.kpis.totalCandidates}
              hint={`${data.kpis.parsedCandidates} parsed by AI`}
              icon={Users}
              tone="primary"
            />
            <StatCard
              label="Open roles"
              value={data.kpis.openJobs}
              hint={`${data.kpis.urgentJobs} urgent · ${data.kpis.clients} clients`}
              icon={Briefcase}
              tone="info"
            />
            <StatCard
              label="Placements"
              value={data.kpis.placements}
              hint={
                data.kpis.avgTimeToHire != null
                  ? `${data.kpis.placementsThisMonth} this month · ${data.kpis.avgTimeToHire}d avg time-to-hire`
                  : `${data.kpis.placementsThisMonth} this month`
              }
              icon={Trophy}
              tone="warning"
            />
          </div>

          {/* Funnel */}
          <div className="rise rise-3">
            <SectionTitle title="Recruitment funnel" hint="Candidates by current pipeline stage" />
            <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {data.funnel.map((step, i) => {
                const max = Math.max(...data.funnel.map((s) => s.count), 1);
                return (
                  <Card key={step.key} hover className="p-4">
                    <p className="num text-[10px] text-muted-foreground/70">
                      {String(i + 1).padStart(2, "0")}
                    </p>
                    <p className="num mt-1 font-display text-[26px] font-bold leading-none">{step.count}</p>
                    <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">{step.label}</p>
                    <Meter
                      value={step.count}
                      max={max}
                      color={i === data.funnel.length - 1 ? "#10b981" : "#ff6b2b"}
                      className="mt-3"
                    />
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Charts */}
          <div className="rise rise-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <CardTitle>Hiring trend</CardTitle>
                  <p className="text-[12px] text-muted-foreground">Sourced vs interviewed vs hired, last 6 months</p>
                </div>
              </CardHeader>
              <CardContent className="h-[260px] pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.trend}>
                    <defs>
                      <linearGradient id="g-sourced" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ff6b2b" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#ff6b2b" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="g-hired" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1f1f1f" vertical={false} />
                    <XAxis dataKey="month" tick={AXIS} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS} axisLine={false} tickLine={false} width={28} />
                    <ChartTooltip />
                    <Area
                      type="monotone"
                      dataKey="sourced"
                      stroke="#ff6b2b"
                      strokeWidth={2}
                      fill="url(#g-sourced)"
                      name="Sourced"
                    />
                    <Area
                      type="monotone"
                      dataKey="interviewed"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="transparent"
                      name="Interviewed"
                    />
                    <Area
                      type="monotone"
                      dataKey="hired"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#g-hired)"
                      name="Hired"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Match score distribution</CardTitle>
                  <p className="text-[12px] text-muted-foreground">Across all matches</p>
                </div>
              </CardHeader>
              <CardContent className="h-[260px] pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.scoreBands}>
                    <CartesianGrid stroke="#1f1f1f" vertical={false} />
                    <XAxis dataKey="band" tick={AXIS} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS} axisLine={false} tickLine={false} width={24} />
                    <ChartTooltip />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Candidates">
                      {data.scoreBands.map((band, i) => (
                        <Cell key={band.band} fill={scoreColor(95 - i * 10)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="rise rise-5 grid gap-4 lg:grid-cols-3">
            {/* AI interview radar */}
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>AI interview signals</CardTitle>
                  <p className="text-[12px] text-muted-foreground">
                    Qualitative only — never part of the ranking score
                  </p>
                </div>
                <Badge tone="info">{data.aiInterviewStats.completed} completed</Badge>
              </CardHeader>
              <CardContent className="h-[250px] pt-2">
                {data.aiInterviewStats.completed === 0 ? (
                  <p className="grid h-full place-items-center text-center text-[13px] text-muted-foreground">
                    No AI interviews completed yet.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={data.aiInterviewStats.radar} outerRadius="72%">
                      <PolarGrid stroke="#242424" />
                      <PolarAngleAxis dataKey="dimension" tick={{ fill: "#8f8f8f", fontSize: 10 }} />
                      <Radar dataKey="score" stroke="#ff6b2b" fill="#ff6b2b" fillOpacity={0.28} name="Avg /10" />
                      <ChartTooltip />
                    </RadarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Skill demand */}
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Skill demand</CardTitle>
                  <p className="text-[12px] text-muted-foreground">Across open job descriptions</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-2.5 pt-1">
                {data.skillDemand.length === 0 && (
                  <p className="py-8 text-center text-[13px] text-muted-foreground">No open roles yet.</p>
                )}
                {data.skillDemand.map((s) => (
                  <div key={s.skill}>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12.5px]">{s.skill}</span>
                      <span className="num text-[11px] text-muted-foreground">{s.count}</span>
                    </div>
                    <Meter
                      value={s.count}
                      max={Math.max(...data.skillDemand.map((x) => x.count), 1)}
                      color="#ff6b2b"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Interview throughput + activity */}
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Interview throughput</CardTitle>
                  <p className="text-[12px] text-muted-foreground">Technical round carries 80% of the final score</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-1">
                <Row label="AI interviews invited" value={data.aiInterviewStats.invited} />
                <Row
                  label="AI completion rate"
                  value={`${data.aiInterviewStats.completionRate}%`}
                  hint={`${data.aiInterviewStats.avgDurationMinutes} min avg`}
                />
                <Row label="Technical interviews" value={data.techInterviewStats.conducted} />
                <Row
                  label="Technical avg score"
                  value={data.techInterviewStats.avgScore}
                  hint={`${data.techInterviewStats.passRate}% pass rate`}
                />
                <Row label="Selected" value={data.techInterviewStats.selected} tone="#10b981" />
                <Row label="Rejected" value={data.techInterviewStats.rejected} tone="#ef4444" />
              </CardContent>
            </Card>
          </div>

          {/* Activity */}
          <div className="rise rise-6">
            <SectionTitle title="Recent activity" hint="Latest events across candidates" />
            <Card>
              <CardContent className="pt-5">
                {data.activity.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-muted-foreground">Nothing has happened yet.</p>
                ) : (
                  <ol className="relative space-y-4 pl-5">
                    <span className="absolute left-[3px] top-1.5 h-[calc(100%-12px)] w-px bg-border" />
                    {data.activity.map((event) => (
                      <li key={event.id} className="relative">
                        <span className="absolute -left-5 top-1.5 size-[7px] rounded-full bg-primary" />
                        <div className="flex flex-wrap items-baseline gap-2">
                          <p className="text-[13px] font-medium">{event.title}</p>
                          {event.actorName && (
                            <span className="text-[11px] text-muted-foreground">by {event.actorName}</span>
                          )}
                          <span className="num ml-auto text-[11px] text-muted-foreground/70">
                            {new Date(event.createdAt).toLocaleString()}
                          </span>
                        </div>
                        {event.detail && (
                          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{event.detail}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>

          <p className="pb-4 text-center text-[11px] text-muted-foreground/60">
            <Building2 className="mr-1 inline size-3" />
            Shortlist threshold {data.kpis.shortlistThreshold} · final score = match × 0.20 + technical × 0.80
          </p>
        </div>
      )}
    </>
  );
}

function Row({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2.5 last:border-0 last:pb-0">
      <div>
        <p className="text-[12.5px] text-foreground/85">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <span className="num font-display text-[17px] font-semibold" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
    </div>
  );
}
