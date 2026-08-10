import { useCallback, useMemo, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { Input, Select } from "./field";
import { cn } from "@/lib/utils";
import {
  DATE_PRESET_LABELS,
  EMPTY_DATE_RANGE,
  isWithinDateRange,
  type DatePreset,
  type DateRange,
} from "@/lib/date-range";

/**
 * Date window control shared by the pipeline lists. Holds its own state and
 * hands back a predicate, so a page adds date filtering with two lines.
 */
export function useDateRange() {
  const [range, setRange] = useState<DateRange>(EMPTY_DATE_RANGE);
  /** True when the row's date belongs in the selected window. */
  const inRange = useCallback(
    (value: Date | string | null | undefined) => isWithinDateRange(value, range),
    [range],
  );
  /* Stable identity so list pages can memoise their filtered rows. */
  return useMemo(
    () => ({ range, setRange, active: range.preset !== "all", inRange }),
    [range, inRange],
  );
}

const PRESETS: DatePreset[] = ["all", "today", "week", "month", "custom"];

export function DateRangeFilter({
  range,
  onChange,
  label = "Date",
  className,
}: {
  range: DateRange;
  onChange: (next: DateRange) => void;
  label?: string;
  className?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <CalendarDays className="size-3.5" /> {label}
      </span>
      <Select
        aria-label={`${label} filter`}
        className="h-8 w-auto min-w-[9.5rem] text-[12.5px]"
        value={range.preset}
        onChange={(e) => {
          const preset = e.target.value as DatePreset;
          /* Opening the custom range pre-fills today so the inputs are never
             both empty, which would silently mean "no filter". */
          onChange(
            preset === "custom"
              ? { preset, from: range.from || today, to: range.to || today }
              : { ...range, preset },
          );
        }}
      >
        {PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {DATE_PRESET_LABELS[preset]}
          </option>
        ))}
      </Select>

      {range.preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label="From date"
            className="h-8 w-auto text-[12.5px]"
            value={range.from}
            max={range.to || undefined}
            onChange={(e) => onChange({ ...range, from: e.target.value })}
          />
          <span className="text-[12px] text-muted-foreground">→</span>
          <Input
            type="date"
            aria-label="To date"
            className="h-8 w-auto text-[12.5px]"
            value={range.to}
            min={range.from || undefined}
            onChange={(e) => onChange({ ...range, to: e.target.value })}
          />
        </div>
      )}

      {range.preset !== "all" && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_DATE_RANGE)}
          className="flex h-8 items-center gap-1 rounded-md border border-border px-2 text-[12px] text-muted-foreground transition-colors hover:border-border-hover hover:text-foreground"
        >
          <X className="size-3" /> Clear
        </button>
      )}
    </div>
  );
}
