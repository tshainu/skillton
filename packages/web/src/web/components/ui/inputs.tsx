import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CURRENCIES } from "@/lib/currency";

/* ------------------------------------------------------------ rating slider */

const RATING_LABEL = ["", "Poor", "Poor", "Weak", "Weak", "Fair", "Fair", "Good", "Good", "Strong", "Excellent"];

/** Drag-bar rating with a live value chip. */
export function RatingSlider({
  value,
  onChange,
  min = 1,
  max = 10,
  hint,
}: {
  value: number | null;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  hint?: string;
}) {
  const current = value ?? Math.round((min + max) / 2);
  const pct = ((current - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={current}
          onChange={(e) => onChange(Number(e.target.value))}
          className="range-primary h-1.5 w-full cursor-pointer appearance-none rounded-full"
          style={{
            background: `linear-gradient(to right, var(--primary) ${pct}%, rgba(255,255,255,0.12) ${pct}%)`,
          }}
        />
        <span className="num w-11 shrink-0 rounded-md border border-primary/35 bg-primary/10 py-0.5 text-center text-[12px] font-semibold text-primary-light">
          {current}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {hint ?? RATING_LABEL[Math.min(current, RATING_LABEL.length - 1)]}
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- radio group */

export interface RadioOption {
  value: string;
  label: string;
  hint?: string;
}

/** Segmented radio group — used for Yes/No and short choice lists. */
export function RadioGroup({
  name,
  value,
  onChange,
  options,
  columns,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: RadioOption[];
  columns?: number;
}) {
  return (
    <div
      className={cn("grid gap-2", columns === 3 ? "sm:grid-cols-3" : columns === 1 ? "" : "sm:grid-cols-2")}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors",
              active
                ? "border-primary/50 bg-primary/10"
                : "border-border bg-white/[0.02] hover:border-border-hover",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              onChange={() => onChange(option.value)}
              className="mt-0.5 size-3.5 shrink-0 accent-[#ff6b2b]"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium leading-snug">{option.label}</span>
              {option.hint && (
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                  {option.hint}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function YesNo({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <RadioGroup
      name={name}
      value={value}
      onChange={onChange}
      options={[
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ]}
    />
  );
}

/* ------------------------------------------------------------- money input */

/** Currency picker + amount, emitting a plain number and an ISO code. */
export function MoneyInput({
  currency,
  amount,
  onCurrencyChange,
  onAmountChange,
  placeholder = "450,000.00",
}: {
  currency: string;
  amount: string;
  onCurrencyChange: (code: string) => void;
  onAmountChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex gap-2">
      <select
        value={currency}
        onChange={(e) => onCurrencyChange(e.target.value)}
        className="num h-9 w-[92px] shrink-0 rounded-md border border-border bg-white/[0.03] px-2 text-[13px] outline-none focus:border-primary/50"
      >
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>
      <input
        value={amount}
        onChange={(e) => onAmountChange(e.target.value)}
        inputMode="decimal"
        placeholder={placeholder}
        className="num h-9 w-full rounded-md border border-border bg-white/[0.03] px-3 text-[13px] outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
      />
    </div>
  );
}

/* ---------------------------------------------------------------- sections */

/** Titled block used to break long forms into readable sections. */
export function FormSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-white/[0.02] p-4">
      <div className="mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">{title}</p>
        {hint && <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
