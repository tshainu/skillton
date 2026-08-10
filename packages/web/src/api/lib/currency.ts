/**
 * Currency parsing + formatting shared by JD salary, matching, placements and reports.
 * Display style: `LKR 450,000.00` / `USD 12,000.00`.
 */

export interface CurrencyOption {
  code: string;
  label: string;
  symbol: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { code: "LKR", label: "Sri Lankan Rupee", symbol: "Rs" },
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GBP", label: "Pound Sterling", symbol: "£" },
  { code: "AUD", label: "Australian Dollar", symbol: "A$" },
  { code: "CAD", label: "Canadian Dollar", symbol: "C$" },
  { code: "AED", label: "UAE Dirham", symbol: "AED" },
  { code: "SAR", label: "Saudi Riyal", symbol: "SAR" },
  { code: "QAR", label: "Qatari Riyal", symbol: "QAR" },
  { code: "SGD", label: "Singapore Dollar", symbol: "S$" },
  { code: "INR", label: "Indian Rupee", symbol: "₹" },
  { code: "MYR", label: "Malaysian Ringgit", symbol: "RM" },
  { code: "JPY", label: "Japanese Yen", symbol: "¥" },
];

export const SALARY_PERIODS = ["hour", "day", "month", "year"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

const PERIOD_LABEL: Record<string, string> = {
  hour: "/hr",
  day: "/day",
  month: "/mo",
  year: "/yr",
};

export function isCurrencyCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const upper = code.trim().toUpperCase();
  return CURRENCIES.some((c) => c.code === upper);
}

export function normalizeCurrency(code: string | null | undefined, fallback = "LKR"): string {
  if (!code) return fallback;
  const upper = code.trim().toUpperCase();
  return isCurrencyCode(upper) ? upper : fallback;
}

/** `450000` -> `450,000.00` (no currency code). */
export function formatAmount(amount: number, decimals = 2): string {
  const fixed = Math.abs(amount).toFixed(decimals);
  const [whole, frac] = fixed.split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = amount < 0 ? "-" : "";
  return frac ? `${sign}${grouped}.${frac}` : `${sign}${grouped}`;
}

/** `LKR 450,000.00`. */
export function formatMoney(
  amount: number | null | undefined,
  currency?: string | null,
  period?: string | null,
): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  const code = normalizeCurrency(currency);
  const suffix = period ? (PERIOD_LABEL[period] ?? "") : "";
  return `${code} ${formatAmount(amount)}${suffix}`;
}

/** `LKR 450,000.00 – 600,000.00/mo`, collapsing to a single value when min === max. */
export function formatSalaryRange(input: {
  currency?: string | null;
  min?: number | null;
  max?: number | null;
  period?: string | null;
  fallback?: string | null;
}): string {
  const { min, max, period } = input;
  const code = normalizeCurrency(input.currency);
  const suffix = period ? (PERIOD_LABEL[period] ?? "") : "";
  const hasMin = typeof min === "number" && !Number.isNaN(min);
  const hasMax = typeof max === "number" && !Number.isNaN(max);
  if (!hasMin && !hasMax) return input.fallback?.trim() ? input.fallback : "—";
  if (hasMin && hasMax && min !== max) {
    return `${code} ${formatAmount(min)} – ${formatAmount(max)}${suffix}`;
  }
  const single = hasMin ? min : (max as number);
  return `${code} ${formatAmount(single as number)}${suffix}`;
}

/**
 * Parses loose salary text (`Rs 450,000 - 600,000 per month`, `USD 12k`) into structured parts.
 * Returns nulls for anything it cannot read rather than guessing.
 */
export function parseSalaryText(raw: string | null | undefined): {
  currency: string | null;
  min: number | null;
  max: number | null;
  period: SalaryPeriod | null;
} {
  const empty = { currency: null, min: null, max: null, period: null };
  if (!raw) return empty;
  const text = raw.trim();
  if (!text) return empty;

  let currency: string | null = null;
  const upper = text.toUpperCase();
  for (const c of CURRENCIES) {
    if (upper.includes(c.code)) {
      currency = c.code;
      break;
    }
  }
  if (!currency) {
    if (/rs\.?/i.test(text) || /₨/.test(text)) currency = "LKR";
    else if (/\$/.test(text)) currency = "USD";
    else if (/€/.test(text)) currency = "EUR";
    else if (/£/.test(text)) currency = "GBP";
    else if (/₹/.test(text)) currency = "INR";
  }

  let period: SalaryPeriod | null = null;
  if (/(per\s*hour|\/\s*hr|hourly)/i.test(text)) period = "hour";
  else if (/(per\s*day|\/\s*day|daily)/i.test(text)) period = "day";
  else if (/(per\s*year|\/\s*yr|annual|p\.?a\.?)/i.test(text)) period = "year";
  else if (/(per\s*month|\/\s*mo|monthly)/i.test(text)) period = "month";

  const numbers: number[] = [];
  const matcher = /(\d[\d,\s]*(?:\.\d+)?)\s*([km])?/gi;
  let match = matcher.exec(text);
  while (match) {
    const digits = (match[1] ?? "").replace(/[,\s]/g, "");
    if (digits) {
      let value = Number(digits);
      const scale = match[2]?.toLowerCase();
      if (scale === "k") value *= 1_000;
      if (scale === "m") value *= 1_000_000;
      if (!Number.isNaN(value) && value > 0) numbers.push(value);
    }
    match = matcher.exec(text);
  }

  if (numbers.length === 0) return { currency, min: null, max: null, period };
  const sorted = [...numbers].sort((a, b) => a - b);
  const min = sorted[0] as number;
  const max = sorted.length > 1 ? (sorted[sorted.length - 1] as number) : min;
  return { currency, min, max, period };
}

/** Coerces form input (`"450,000.00"`, `""`) into a number or null. */
export function parseAmountInput(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  const cleaned = value.replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}
