// Business calendar helpers. Business dates are `YYYY-MM-DD` strings in
// Asia/Jakarta and never shift with the server time zone (PRD: Time rules).

export const BUSINESS_TIME_ZONE = "Asia/Jakarta";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const cyclePattern = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Business date (Asia/Jakarta) of an instant. */
export function businessDateOf(instant: Date): string {
  return dateFormatter.format(instant);
}

export function isBusinessDate(value: string): boolean {
  const match = datePattern.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Calendar arithmetic on business dates, independent of any time zone. */
export function addDays(date: string, days: number): string {
  if (!isBusinessDate(date)) throw new Error(`Invalid business date: ${date}`);
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function isCycleKey(value: string): boolean {
  return cyclePattern.test(value);
}

/** Monthly cycle key (`YYYY-MM`) containing a business date. */
export function cycleKeyOf(date: string): string {
  if (!isBusinessDate(date)) throw new Error(`Invalid business date: ${date}`);
  return date.slice(0, 7);
}

export function nextCycleKey(cycle: string): string {
  if (!isCycleKey(cycle)) throw new Error(`Invalid cycle key: ${cycle}`);
  const [year, month] = cycle.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function previousCycleKey(cycle: string): string {
  if (!isCycleKey(cycle)) throw new Error(`Invalid cycle key: ${cycle}`);
  const [year, month] = cycle.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** `count` months ending at `cycle`, oldest first. */
export function trailingCycleKeys(cycle: string, count: number): string[] {
  const months = [cycle];
  while (months.length < count) months.unshift(previousCycleKey(months[0]));
  return months;
}
