// Display formatting for dates and amounts (PRD: Representasi uang, Time rules).
import { formatIdr, parseIdrDecimal } from "./money";

const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const longMonths = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** "2027-02-07" → "7 Feb 2027". */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${months[month - 1]} ${year}`;
}

/** "2027-02" → "Februari 2027". */
export function formatCycle(cycle: string): string {
  const [year, month] = cycle.split("-").map(Number);
  return `${longMonths[month - 1]} ${year}`;
}

const dateTimeFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** ISO timestamp in Asia/Jakarta, e.g. "7 Feb 2027 21.00". */
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFormatter.format(new Date(iso)) : "—";
}

/** Canonical API amount string → "Rp831.999,93" / "−Rp50.000". */
export function money(value: string | null | undefined): string {
  return value === null || value === undefined ? "—" : formatIdr(parseIdrDecimal(value));
}

/** Derived averages are approximate (PRD: `≈` marker). */
export function approx(value: string | null | undefined): string {
  return value === null || value === undefined ? "—" : `≈ ${money(value)}`;
}

export const isNegative = (value: string | null | undefined) => Boolean(value && value.startsWith("-"));
export const isZero = (value: string | null | undefined) => value === "0";

/** Local date/time input value in Asia/Jakarta for an ISO instant. */
export function jakartaInputValue(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export const jakartaIso = (inputValue: string) => `${inputValue}:00+07:00`;
