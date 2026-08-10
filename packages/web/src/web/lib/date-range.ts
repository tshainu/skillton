/**
 * Shared date-window logic for the pipeline lists (HR screening, AI interview,
 * technical interview). Every list filters on its own date column but the window
 * itself — today, this week, this month, a custom span — is defined once here.
 */

export type DatePreset = "all" | "today" | "week" | "month" | "custom";

export interface DateRange {
  preset: DatePreset;
  /** Inclusive `YYYY-MM-DD` bounds, used only when `preset` is "custom". */
  from: string;
  to: string;
}

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  all: "All time",
  today: "Today",
  week: "This week",
  month: "This month",
  custom: "Custom range",
};

export const EMPTY_DATE_RANGE: DateRange = { preset: "all", from: "", to: "" };

/** Local midnight, so "today" means the recruiter's day and not UTC's. */
function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

/** Resolves the window to absolute bounds. `null` means unbounded on that side. */
export function resolveDateRange(range: DateRange, now = new Date()) {
  if (range.preset === "today") return { from: startOfDay(now), to: endOfDay(now) };

  if (range.preset === "week") {
    /* Weeks run Monday to Sunday — the working week recruiters report on. */
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    return { from: startOfDay(monday), to: endOfDay(now) };
  }

  if (range.preset === "month") {
    return { from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: endOfDay(now) };
  }

  if (range.preset === "custom") {
    const from = range.from ? startOfDay(new Date(`${range.from}T00:00:00`)) : null;
    const to = range.to ? endOfDay(new Date(`${range.to}T00:00:00`)) : null;
    return { from, to };
  }

  return { from: null, to: null };
}

/**
 * Whether a row's date falls inside the window. Rows with no date are kept —
 * a missing timestamp is a data gap, and hiding the row would look like the
 * record had vanished.
 */
export function isWithinDateRange(value: Date | string | null | undefined, range: DateRange, now = new Date()) {
  if (range.preset === "all") return true;
  if (range.preset === "custom" && !range.from && !range.to) return true;
  if (!value) return true;

  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return true;

  const { from, to } = resolveDateRange(range, now);
  if (from && at < from) return false;
  if (to && at > to) return false;
  return true;
}

/** Short human summary of the active window, for a "showing …" line. */
export function describeDateRange(range: DateRange) {
  if (range.preset !== "custom") return DATE_PRESET_LABELS[range.preset];
  if (range.from && range.to) return `${range.from} → ${range.to}`;
  if (range.from) return `from ${range.from}`;
  if (range.to) return `until ${range.to}`;
  return "Custom range";
}
