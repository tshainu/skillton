import { RefreshCw, TimerOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function scoreColor(score: number): string {
  if (score >= 85) return "#10b981";
  if (score >= 70) return "#ff6b2b";
  if (score >= 55) return "#f59e0b";
  return "#ef4444";
}

/** Circular score dial. Renders the expired state when `score` is null. */
export function ScoreRing({
  score,
  size = 56,
  label,
  className,
}: {
  score: number | null;
  size?: number;
  label?: string;
  className?: string;
}) {
  const stroke = size >= 72 ? 6 : 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const color = score == null ? "#4b4b4b" : scoreColor(score);

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#242424" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        {score == null ? (
          <TimerOff className="size-4 text-muted-foreground" />
        ) : (
          <div className="text-center leading-none">
            <span className="num font-semibold" style={{ fontSize: size * 0.3 }}>
              {Math.round(score)}
            </span>
            {label && <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Inline numeric score pill. */
export function ScorePill({ score, className }: { score: number | null; className?: string }) {
  if (score == null) {
    return (
      <span
        className={cn(
          "num inline-flex items-center gap-1 rounded-md border border-border bg-white/[0.02] px-2 py-0.5 text-xs text-muted-foreground line-through decoration-muted-foreground/60",
          className,
        )}
      >
        --
      </span>
    );
  }
  const color = scoreColor(score);
  return (
    <span
      className={cn("num inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold", className)}
      style={{ color, background: `${color}1f`, border: `1px solid ${color}45` }}
    >
      {score.toFixed(1)}
    </span>
  );
}

/**
 * The score-expiry notice. Expired matches keep the candidate visible but hide
 * every number and offer a one-click re-run.
 */
export function ExpiredScoreNotice({
  onRerun,
  pending,
  expiredAt,
  compact = false,
  className,
}: {
  onRerun?: () => void;
  pending?: boolean;
  expiredAt?: Date | string | null;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2",
        className,
      )}
    >
      <TimerOff className="size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-warning">Score expired — re-run match</p>
        {!compact && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Excluded from ranking and search
            {expiredAt ? ` since ${new Date(expiredAt).toLocaleDateString()}` : ""}. The candidate stays in your
            library.
          </p>
        )}
      </div>
      {onRerun && (
        <Button size="sm" variant="outline" onClick={onRerun} disabled={pending} className="shrink-0">
          {pending ? <RefreshCw className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Re-run
        </Button>
      )}
    </div>
  );
}

/** Horizontal meter for section scores and coverage. */
export function Meter({
  value,
  max = 100,
  color,
  className,
}: {
  value: number;
  max?: number;
  color?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]", className)}>
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: color ?? scoreColor((value / max) * 100) }}
      />
    </div>
  );
}
