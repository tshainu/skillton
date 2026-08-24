import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "./card";
import { Modal } from "./modal";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rise rise-1 mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
        )}
        <h1 className="font-display text-[26px] font-bold sm:text-[30px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "primary" | "success" | "warning" | "danger" | "info";
  className?: string;
}) {
  const toneColor = {
    default: "#a3a3a3",
    primary: "#ff6b2b",
    success: "#10b981",
    warning: "#f59e0b",
    danger: "#ef4444",
    info: "#3b82f6",
  }[tone];

  return (
    <Card hover className={cn("relative overflow-hidden p-4", className)}>
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${toneColor}88, transparent)` }}
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-4 shrink-0" style={{ color: toneColor }} />}
      </div>
      <p className="num mt-2.5 font-display text-[28px] font-bold leading-none">{value}</p>
      {hint && <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </Card>
  );
}

/** Table wrapper with the standard dark styling. */
export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("glass overflow-hidden rounded-xl", className)}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">{children}</table>
      </div>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "border-b border-border px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("border-b border-border/60 px-4 py-3 align-middle", className)}>{children}</td>;
}

export function Tr({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn("transition-colors hover:bg-white/[0.028]", onClick && "cursor-pointer", className)}
    >
      {children}
    </tr>
  );
}

export function ChipList({
  items,
  max = 6,
  tone,
  label = "Skills",
}: {
  items: string[];
  max?: number;
  tone?: "matched" | "missing";
  /** Heading for the overflow modal, e.g. "Skills missing". */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const styles =
    tone === "matched"
      ? "border-success/25 bg-success/10 text-success"
      : tone === "missing"
        ? "border-destructive/25 bg-destructive/10 text-destructive"
        : "border-border bg-white/[0.03] text-foreground/80";
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((item) => (
        <span key={item} className={cn("rounded border px-1.5 py-0.5 text-[11px]", styles)}>
          {item}
        </span>
      ))}
      {rest > 0 && (
        <>
          {/* "+4" means "4 more" — it has to show them, not just count them. */}
          <button
            type="button"
            title={`Show ${rest} more`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(true);
            }}
            className="rounded px-1 py-0.5 text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-primary"
          >
            +{rest}
          </button>
          <Modal
            open={open}
            onClose={() => setOpen(false)}
            title={label}
            description={`All ${items.length}`}
          >
            <div className="flex flex-wrap gap-1.5">
              {items.map((item) => (
                <span key={item} className={cn("rounded border px-2 py-1 text-[12px]", styles)}>
                  {item}
                </span>
              ))}
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
