import type * as React from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "muted";

const TONES: Record<Tone, string> = {
  neutral: "border-border bg-white/[0.04] text-foreground/90",
  primary: "border-primary/35 bg-primary/12 text-primary-light",
  success: "border-success/30 bg-success/12 text-success",
  warning: "border-warning/30 bg-warning/12 text-warning",
  danger: "border-destructive/30 bg-destructive/12 text-destructive",
  info: "border-info/30 bg-info/12 text-info",
  muted: "border-border bg-white/[0.02] text-muted-foreground",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Candidate / job status → tone + label, following the PRD tag system. */
export function statusTone(status: string): { tone: Tone; label: string } {
  const map: Record<string, { tone: Tone; label: string }> = {
    new: { tone: "muted", label: "New" },
    parsing: { tone: "muted", label: "Parsing" },
    parsed: { tone: "neutral", label: "Parsed" },
    screening: { tone: "neutral", label: "Screening" },
    shortlisted: { tone: "primary", label: "Shortlisted" },
    hr_screening: { tone: "neutral", label: "HR screening" },
    hr_hold: { tone: "warning", label: "HR hold" },
    hr_rejected: { tone: "danger", label: "HR rejected" },
    ai_interview_pending: { tone: "primary", label: "AI interview pending" },
    ai_interview_completed: { tone: "info", label: "AI interview done" },
    tech_interview_pending: { tone: "primary", label: "Tech pending" },
    tech_interview_completed: { tone: "info", label: "Tech completed" },
    interviewing: { tone: "info", label: "Interviewing" },
    tech_rejected: { tone: "danger", label: "Tech rejected" },
    tech_hold: { tone: "warning", label: "Tech hold" },
    client_review: { tone: "info", label: "Client review" },
    offered: { tone: "primary", label: "Offered" },
    hired: { tone: "success", label: "Hired" },
    rejected: { tone: "danger", label: "Rejected" },
    blacklisted: { tone: "danger", label: "Blacklisted" },
    open: { tone: "success", label: "Open" },
    on_hold: { tone: "warning", label: "On hold" },
    closed: { tone: "muted", label: "Closed" },
    filled: { tone: "info", label: "Filled" },
    active: { tone: "success", label: "Active" },
    probation: { tone: "warning", label: "Probation" },
    completed: { tone: "info", label: "Completed" },
    left: { tone: "danger", label: "Left" },
    pending: { tone: "muted", label: "Pending" },
    invited: { tone: "primary", label: "Invited" },
    in_progress: { tone: "info", label: "In progress" },
    expired: { tone: "muted", label: "Expired" },
    terminated: { tone: "danger", label: "Terminated" },
    selected: { tone: "success", label: "Selected" },
    strong_hire: { tone: "success", label: "Strong hire" },
    hire: { tone: "success", label: "Hire" },
    hold: { tone: "warning", label: "Hold" },
    urgent: { tone: "danger", label: "Urgent" },
    high: { tone: "warning", label: "High" },
    medium: { tone: "neutral", label: "Medium" },
    low: { tone: "muted", label: "Low" },
    success: { tone: "success", label: "Success" },
    failed: { tone: "danger", label: "Failed" },
  };
  /* Unknown statuses still render with a capitalised first letter. */
  const fallback = status.replace(/_/g, " ").trim();
  return map[status] ?? { tone: "neutral", label: fallback.charAt(0).toUpperCase() + fallback.slice(1) };
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const { tone, label } = statusTone(status);
  return (
    <Badge tone={tone} className={cn("capitalize", className)}>
      {label}
    </Badge>
  );
}
