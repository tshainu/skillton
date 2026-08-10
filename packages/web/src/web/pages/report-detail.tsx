import { useCallback, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Download, FileText, LayoutDashboard, Printer, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { PageHeader, TableShell, Td, Th, Tr } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/feedback";
import { downloadCsv, printReport, stamp } from "@/lib/export";
import type { ExportPayload, ReportViewProps } from "@/components/reports/report-views";
import {
  AiMatchingReport,
  CandidateAnalyticsReport,
  ClientPerformanceReport,
  ExecutiveReport,
  JdPerformanceReport,
  PipelineReport,
  PlacementsReport,
  RecruiterPerformanceReport,
} from "@/components/reports/report-views";
import { REPORTS } from "./reports";

/**
 * Report shell — title, export controls and the selected report body. Printing
 * uses the `print:` styles so the browser's own "Save as PDF" produces the PDF
 * export without shipping a PDF renderer.
 */

const VIEWS: Record<string, (props: ReportViewProps) => React.ReactElement> = {
  executive: ExecutiveReport,
  pipeline: PipelineReport,
  "jd-performance": JdPerformanceReport,
  "candidate-analytics": CandidateAnalyticsReport,
  "ai-matching": AiMatchingReport,
  "recruiter-performance": RecruiterPerformanceReport,
  "client-performance": ClientPerformanceReport,
  placements: PlacementsReport,
};

export default function ReportDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const meta = REPORTS.find((r) => r.slug === slug);
  const View = VIEWS[slug];

  const payload = useRef<ExportPayload | null>(null);
  const [ready, setReady] = useState(false);
  const [period, setPeriod] = useState<"monthly" | "quarterly" | "yearly">("monthly");
  /* Charts are for reading on screen; the table is what gets printed, signed and
     filed. Both are driven by the same registered payload. */
  const [view, setView] = useState<"visual" | "table">("visual");

  const register = useCallback((next: ExportPayload) => {
    payload.current = next;
    setReady(true);
  }, []);

  if (!meta || !View) {
    return (
      <EmptyState
        title="Report not found"
        body="That report does not exist. Pick one from the reports menu."
        action={
          <Link href="/reports">
            <Button variant="outline">Back to reports</Button>
          </Link>
        }
      />
    );
  }

  const fileName = `matchhire-${slug}-${stamp()}`;

  return (
    <div data-print-root>
      <div className="print:hidden">
        <PageHeader
          eyebrow={meta.level}
          title={meta.title}
          subtitle={meta.description}
          actions={
            <>
              <Link href="/reports">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="size-4" />
                  All reports
                </Button>
              </Link>
              <div className="flex overflow-hidden rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => setView("visual")}
                  className={
                    view === "visual"
                      ? "flex h-8 items-center gap-1.5 bg-primary px-2.5 text-[12px] font-medium text-primary-foreground"
                      : "flex h-8 items-center gap-1.5 px-2.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                  }
                >
                  <LayoutDashboard className="size-3.5" /> Visual
                </button>
                <button
                  type="button"
                  onClick={() => setView("table")}
                  className={
                    view === "table"
                      ? "flex h-8 items-center gap-1.5 bg-primary px-2.5 text-[12px] font-medium text-primary-foreground"
                      : "flex h-8 items-center gap-1.5 px-2.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                  }
                >
                  <Table2 className="size-3.5" /> Table
                </button>
              </div>
              {slug === "placements" && (
                <Select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as typeof period)}
                  className="w-[130px]"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </Select>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={!ready}
                onClick={() => {
                  if (payload.current) {
                    downloadCsv(fileName, payload.current.headers, payload.current.rows);
                  }
                }}
              >
                <Download className="size-4" />
                CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => printReport(`${meta.title} — Skillton`)}>
                <FileText className="size-4" />
                PDF
              </Button>
              <Button size="sm" onClick={() => printReport(`${meta.title} — Skillton`)}>
                <Printer className="size-4" />
                Print
              </Button>
            </>
          }
        />
      </div>

      {/* Print-only header so the exported PDF is self-describing. */}
      <div className="mb-6 hidden print:block">
        <p className="text-[11px] uppercase tracking-[0.18em]">{meta.level}</p>
        <h1 className="text-2xl font-bold">{meta.title}</h1>
        <p className="text-sm">
          Skillton · generated {new Date().toLocaleString()}
        </p>
      </div>

      {/* The report body stays mounted in table mode — it is what registers the
          rows the table renders. */}
      <div className={view === "table" ? "hidden" : undefined}>
        <View register={register} period={period} />
      </div>

      {view === "table" && (
        <Card className="p-5">
          {!ready || !payload.current ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">Preparing the table…</p>
          ) : (
            <>
              <p className="mb-3 text-[12px] text-muted-foreground print:hidden">
                {payload.current.rows.length} row{payload.current.rows.length === 1 ? "" : "s"} · this is exactly
                what the CSV and the printed copy contain.
              </p>
              <TableShell>
                <thead>
                  <tr>
                    {payload.current.headers.map((header) => (
                      <Th key={header}>{header}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payload.current.rows.map((row, i) => (
                    <Tr key={i}>
                      {row.map((cell, j) => (
                        <Td key={j} className={typeof cell === "number" ? "num" : undefined}>
                          {cell === null || cell === undefined || cell === "" ? "—" : String(cell)}
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
