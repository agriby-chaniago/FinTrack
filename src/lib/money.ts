// IDR money helpers shared by server and client code.
//
// Amounts are always an integer number of minor units (sen, 1/100 rupiah) held
// in a bigint. JavaScript `number` is never used for money (PRD: Representasi uang).

export type MinorUnits = bigint;

const MAX_MINOR = 9_223_372_036_854_775_807n; // PostgreSQL bigint upper bound

export type MoneyParseErrorCode = "INVALID_FORMAT" | "TOO_MANY_DECIMALS" | "OUT_OF_RANGE";

export class MoneyParseError extends Error {
  readonly code: MoneyParseErrorCode;

  constructor(code: MoneyParseErrorCode) {
    super(code);
    this.name = "MoneyParseError";
    this.code = code;
  }
}

function build(negative: boolean, whole: string, fraction: string): MinorUnits {
  if (fraction.length > 2) throw new MoneyParseError("TOO_MANY_DECIMALS");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  if (minor > MAX_MINOR) throw new MoneyParseError("OUT_OF_RANGE");
  return negative ? -minor : minor;
}

/**
 * Parses the canonical API representation: an optional minus sign, digits, and
 * at most two fractional digits after a dot, e.g. "831999.93" or "-50000".
 * More than two fractional digits are rejected, never rounded.
 */
export function parseIdrDecimal(input: string): MinorUnits {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if (!match) throw new MoneyParseError("INVALID_FORMAT");
  return build(Boolean(match[1]), match[2], match[3] ?? "");
}

/**
 * Parses what a person types in an Indonesian amount field: optional "Rp",
 * "." as thousands separator (groups of three), and "," before at most two
 * fractional digits, e.g. "Rp831.999,93", "400000", "−50.000".
 */
export function parseIdrInput(input: string): MinorUnits {
  const cleaned = input.replace(/\s+/g, "").replace(/^([-−])?Rp/i, "$1");
  const match = /^([-−])?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/.exec(cleaned);
  if (!match) throw new MoneyParseError("INVALID_FORMAT");
  return build(Boolean(match[1]), match[2].replaceAll(".", ""), match[3] ?? "");
}

function split(minor: MinorUnits): { negative: boolean; whole: string; fraction: string } {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  return { negative, whole: (absolute / 100n).toString(), fraction: (absolute % 100n).toString().padStart(2, "0") };
}

/** Canonical API string: "831999.93", "831999.90", "400000", "-50000". */
export function toIdrDecimal(minor: MinorUnits): string {
  const { negative, whole, fraction } = split(minor);
  return `${negative ? "-" : ""}${whole}${fraction === "00" ? "" : `.${fraction}`}`;
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Amount without the currency prefix, e.g. "831.999,93" or "400.000". */
export function formatIdrNumber(minor: MinorUnits): string {
  const { negative, whole, fraction } = split(minor);
  return `${negative ? "−" : ""}${groupThousands(whole)}${fraction === "00" ? "" : `,${fraction}`}`;
}

/**
 * Display format (PRD): whole rupiah without ",00", non-zero fractions with two
 * digits including trailing zero, and a leading minus sign: "−Rp50.000".
 */
export function formatIdr(minor: MinorUnits): string {
  const { negative, whole, fraction } = split(minor);
  return `${negative ? "−" : ""}Rp${groupThousands(whole)}${fraction === "00" ? "" : `,${fraction}`}`;
}
