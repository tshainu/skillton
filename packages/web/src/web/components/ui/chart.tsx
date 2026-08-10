import { cn } from "@/lib/utils";
import { scoreColor } from "./score";

/**
 * Lightweight SVG/CSS charts. No charting dependency: every report renders from
 * plain `{ label, value }` series, which keeps the print/PDF output crisp.
 */

export interface Point {
  label: string;
  value: number;
}

const PALETTE = ["#ff6b2b", "#10b981", "#3b82f6", "#f59e0b", "#a855f7", "#ef4444", "#14b8a6", "#eab308"];

export function paletteColor(index: number) {
  return PALETTE[index % PALETTE.length]!;
}

/** Horizontal bars — the default for any ranked list. */
export function BarList({
  data,
  max,
  color,
  suffix = "",
  className,
  emptyLabel = "No data yet",
}: {
  data: Point[];
  max?: number;
  color?: string;
  suffix?: string;
  className?: string;
  emptyLabel?: string;
}) {
  if (!data.length) return <p className="py-6 text-center text-xs text-muted-foreground">{emptyLabel}</p>;
  const peak = max ?? Math.max(...data.map((d) => d.value), 1);

  return (
    <div className={cn("space-y-2.5", className)}>
      {data.map((point, index) => (
        <div key={point.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[12px]">
            <span className="truncate text-foreground/85">{point.label}</span>
            <span className="num shrink-0 font-semibold">
              {point.value}
              {suffix}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.max(2, (point.value / peak) * 100)}%`,
                background: color ?? paletteColor(index),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Recruitment funnel — stacked tapering bars with conversion labels. */
export function Funnel({
  data,
  className,
}: {
  data: { stage: string; count: number }[];
  className?: string;
}) {
  const peak = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className={cn("space-y-1.5", className)}>
      {data.map((row, index) => {
        const previous = index === 0 ? row.count : (data[index - 1]?.count ?? row.count);
        const conversion = previous ? Math.round((row.count / previous) * 100) : 0;
        const width = Math.max(6, (row.count / peak) * 100);
        return (
          <div key={row.stage} className="flex items-center gap-3">
            <span className="w-[140px] shrink-0 truncate text-[12px] text-muted-foreground">{row.stage}</span>
            <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-white/[0.04]">
              <div
                className="flex h-full items-center rounded-md px-2.5 transition-all duration-700"
                style={{
                  width: `${width}%`,
                  background: `linear-gradient(90deg, ${paletteColor(index)}66, ${paletteColor(index)}22)`,
                  borderLeft: `2px solid ${paletteColor(index)}`,
                }}
              >
                <span className="num text-[12px] font-semibold">{row.count.toLocaleString()}</span>
              </div>
            </div>
            <span className="num w-12 shrink-0 text-right text-[11px] text-muted-foreground">
              {index === 0 ? "—" : `${conversion}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Donut for distributions with a handful of categories. */
export function Donut({ data, size = 148, className }: { data: Point[]; size?: number; className?: string }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (!total) return <p className="py-6 text-center text-xs text-muted-foreground">No data yet</p>;

  const stroke = 18;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className={cn("flex flex-wrap items-center gap-5", className)}>
      <svg width={size} height={size} className="-rotate-90 shrink-0">
        {data.map((point, index) => {
          const fraction = point.value / total;
          const dash = fraction * circumference;
          const element = (
            <circle
              key={point.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={paletteColor(index)}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return element;
        })}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((point, index) => (
          <li key={point.label} className="flex items-center gap-2 text-[12px]">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: paletteColor(index) }}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{point.label}</span>
            <span className="num font-semibold">{point.value}</span>
            <span className="num w-10 text-right text-muted-foreground">
              {Math.round((point.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Sparkline-style trend for monthly series. */
export function TrendLine({ data, height = 120, className }: { data: Point[]; height?: number; className?: string }) {
  if (data.length < 2) return <p className="py-6 text-center text-xs text-muted-foreground">Not enough data yet</p>;

  const peak = Math.max(...data.map((d) => d.value), 1);
  const step = 100 / (data.length - 1);
  const points = data.map((d, i) => `${i * step},${100 - (d.value / peak) * 90}`).join(" ");

  return (
    <div className={className}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }} className="w-full">
        <polyline points={`0,100 ${points} 100,100`} fill="#ff6b2b18" stroke="none" />
        <polyline
          points={points}
          fill="none"
          stroke="#ff6b2b"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>
      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
    </div>
  );
}

/** Skills heat map — intensity-shaded chips. */
export function HeatMap({
  data,
  className,
}: {
  data: { label: string; value: number; intensity: number }[];
  className?: string;
}) {
  if (!data.length) return <p className="py-6 text-center text-xs text-muted-foreground">No data yet</p>;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {data.map((item) => (
        <span
          key={item.label}
          className="rounded-md border px-2 py-1 text-[12px]"
          style={{
            background: `rgba(255,107,43,${0.06 + (item.intensity / 100) * 0.32})`,
            borderColor: `rgba(255,107,43,${0.15 + (item.intensity / 100) * 0.45})`,
          }}
          title={`${item.value} candidates`}
        >
          {item.label}
          <span className="num ml-1.5 text-muted-foreground">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

/** Score band histogram, coloured by band quality. */
export function ScoreHistogram({ data, className }: { data: Point[]; className?: string }) {
  const peak = Math.max(...data.map((d) => d.value), 1);
  const bandScore: Record<string, number> = {
    "90–100": 95,
    "80–90": 85,
    "70–80": 75,
    "60–70": 65,
    "Below 60": 45,
  };

  return (
    <div className={cn("flex h-40 items-end gap-3", className)}>
      {data.map((point) => (
        <div key={point.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <span className="num text-[12px] font-semibold">{point.value}</span>
          <div
            className="w-full rounded-t-md transition-all duration-700"
            style={{
              height: `${Math.max(3, (point.value / peak) * 100)}%`,
              background: scoreColor(bandScore[point.label] ?? 60),
              opacity: 0.85,
            }}
          />
          <span className="truncate text-[10px] text-muted-foreground">{point.label}</span>
        </div>
      ))}
    </div>
  );
}
