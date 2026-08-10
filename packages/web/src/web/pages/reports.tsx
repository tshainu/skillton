import { Link } from "wouter";
import {
  ArrowRight,
  BarChart3,
  Briefcase,
  Building2,
  Cpu,
  Filter,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader, StatCard } from "@/components/ui/page";
import { useReportCatalogue } from "@/queries/reports";

/** Report catalogue. Every report exports to PDF and CSV and is printable. */

export interface ReportMeta {
  slug: string;
  title: string;
  level: string;
  description: string;
  icon: LucideIcon;
}

export const REPORTS: ReportMeta[] = [
  {
    slug: "executive",
    title: "Executive Dashboard",
    level: "Executive management",
    description: "The whole business in one screen: KPIs, funnel, hiring trend, recruiter and client performance.",
    icon: BarChart3,
  },
  {
    slug: "pipeline",
    title: "Recruitment Pipeline",
    level: "Recruitment operations",
    description: "Every stage from CV upload to joining, with conversion and drop-off at each step.",
    icon: Filter,
  },
  {
    slug: "jd-performance",
    title: "Job Description Performance",
    level: "Recruitment operations",
    description: "Per JD: CVs received, match distribution, stage pass rates, offer and joining rate, time to fill.",
    icon: Briefcase,
  },
  {
    slug: "candidate-analytics",
    title: "Candidate Analytics",
    level: "Candidate analytics",
    description: "Growth, experience, education, technology and location distribution plus a skills heat map.",
    icon: Users,
  },
  {
    slug: "ai-matching",
    title: "AI Matching Analytics",
    level: "Candidate analytics",
    description: "Match score quality, accuracy, recruiter overrides, and AI/technical interview aggregates.",
    icon: Cpu,
  },
  {
    slug: "recruiter-performance",
    title: "Recruiter Performance",
    level: "Recruiter performance",
    description: "Per recruiter: candidates processed, interviews, selections, placements and a leaderboard.",
    icon: UserRound,
  },
  {
    slug: "client-performance",
    title: "Client Performance",
    level: "Client reports",
    description: "Per client: open and filled positions, time to fill, interview/offer/joining ratios, repeat business.",
    icon: Building2,
  },
  {
    slug: "placements",
    title: "Placement Report",
    level: "Executive management",
    description: "Monthly, quarterly or yearly offers, joins, dropouts and success rate by client, department and recruiter.",
    icon: Trophy,
  },
];

export default function ReportsPage() {
  const { data } = useReportCatalogue();

  const levels = [...new Set(REPORTS.map((r) => r.level))];

  return (
    <div>
      <PageHeader
        eyebrow="Insights"
        title="Reports"
        subtitle="Eight reports across executive, operations, recruiter, client and candidate levels. Each one exports to PDF and CSV, and prints cleanly."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Available reports" value={REPORTS.length} icon={BarChart3} tone="primary" />
        <StatCard label="New candidates (30d)" value={data?.newCandidates30d ?? "—"} icon={Users} />
        <StatCard
          label="Last placement"
          value={data?.lastPlacementAt ? new Date(data.lastPlacementAt).toLocaleDateString() : "—"}
          icon={Trophy}
          tone="success"
        />
      </div>

      {levels.map((level) => (
        <section key={level} className="mb-7">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{level}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {REPORTS.filter((r) => r.level === level).map((report) => (
              <Link key={report.slug} href={`/reports/${report.slug}`}>
                <Card hover className="group flex h-full items-start gap-4 p-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-white/[0.03]">
                    <report.icon className="size-[18px] text-primary" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[15px] font-semibold">{report.title}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                      {report.description}
                    </p>
                  </div>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
