/**
 * Currency helpers for the UI. Single source of truth lives with the API so a
 * salary formatted in a JD, a match, a placement and a report always matches.
 */
export {
  CURRENCIES,
  SALARY_PERIODS,
  formatAmount,
  formatMoney,
  formatSalaryRange,
  isCurrencyCode,
  normalizeCurrency,
  parseAmountInput,
  parseSalaryText,
} from "../../api/lib/currency";
export type { CurrencyOption, SalaryPeriod } from "../../api/lib/currency";
