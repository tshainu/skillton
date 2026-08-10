import type * as React from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-white/[0.055]", className)} />;
}

/** Standard loading block for a page section. */
export function LoadingBlock({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function StatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[104px] w-full rounded-xl" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="mb-4 grid size-11 place-items-center rounded-xl border border-border bg-white/[0.03]">
          <Icon className="size-5 text-muted-foreground" />
        </span>
      )}
      <p className="font-display text-[15px] font-semibold">{title}</p>
      {body && <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message, className }: { message: string; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive",
        className,
      )}
    >
      {message}
    </div>
  );
}
