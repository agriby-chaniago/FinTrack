"use client";

import { useId, useState } from "react";

import { formatIdrNumber, MoneyParseError, parseIdrDecimal, parseIdrInput, toIdrDecimal } from "@/lib/money";

/** Regroups what the person typed ("1234567,8") as "1.234.567,8" without rounding. */
function regroup(raw: string): string {
  const negative = /^[-−]/.test(raw.trim());
  const [integerPart, ...rest] = raw.replace(/[^\d,]/g, "").split(",");
  const digits = integerPart.replace(/^0+(?=\d)/, "");
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = rest.length > 0 ? `,${rest.join("")}` : "";
  return `${negative ? "−" : ""}${grouped}${fraction}`;
}

function toDisplay(value: string | null): string {
  return value === null ? "" : formatIdrNumber(parseIdrDecimal(value));
}

export type AmountInputProps = {
  label: string;
  /** Canonical decimal string (e.g. "831999.93") or null when empty. */
  value: string | null;
  onChange: (value: string | null) => void;
  error?: string;
  hint?: string;
  allowNegative?: boolean;
};

/**
 * Exact IDR input: visible label, "Rp" prefix, numeric keyboard, Indonesian
 * grouping while typing, and inline errors. It never rounds: three or more
 * fractional digits are reported instead of being cut off.
 */
export function AmountInput({ label, value, onChange, error, hint, allowNegative = false }: AmountInputProps) {
  const id = useId();
  const [text, setText] = useState(() => toDisplay(value));
  const [localError, setLocalError] = useState<string>();

  function handleChange(raw: string) {
    const next = regroup(allowNegative ? raw : raw.replace(/[-−]/g, ""));
    setText(next);
    if (next === "" || next === "−") {
      setLocalError(undefined);
      onChange(null);
      return;
    }
    try {
      onChange(toIdrDecimal(parseIdrInput(next)));
      setLocalError(undefined);
    } catch (caught) {
      setLocalError(
        caught instanceof MoneyParseError && caught.code === "TOO_MANY_DECIMALS"
          ? "Maksimal dua angka di belakang koma."
          : "Format nominal tidak valid.",
      );
    }
  }

  const message = localError ?? error;
  const describedBy = [message ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div
        className={`mt-1 flex h-11 items-center border bg-surface focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 focus-within:ring-offset-surface ${
          message ? "border-danger-fg" : "border-control"
        }`}
      >
        <span className="pl-3 pr-1 text-muted" aria-hidden="true">
          Rp
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          aria-invalid={message ? true : undefined}
          aria-describedby={describedBy}
          className="h-full w-full bg-transparent pr-3 text-base tabular-nums outline-none"
        />
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {message ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger-fg">
          {message}
        </p>
      ) : null}
    </div>
  );
}
