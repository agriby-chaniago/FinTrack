import { z } from "zod";

import { isBusinessDate } from "@/lib/business-time";
import { parseIdrDecimal } from "@/lib/money";

/** Canonical decimal amount string that is strictly positive, e.g. "150000" or "831999.93". */
export const positiveAmount = z.string().refine((value) => {
  try {
    return parseIdrDecimal(value) > 0n;
  } catch {
    return false;
  }
}, "must be a positive IDR amount with at most two decimals");

/** Canonical decimal amount string that is zero or positive. */
export const nonNegativeAmount = z.string().refine((value) => {
  try {
    return parseIdrDecimal(value) >= 0n;
  } catch {
    return false;
  }
}, "must be a non-negative IDR amount with at most two decimals");

export const businessDate = z.string().refine(isBusinessDate, "must be a YYYY-MM-DD date");

export const note = z.string().trim().max(500).nullish();

/** Answer to "Sudah termasuk saldo awal?" for events dated on the cutover day. */
export const cutoverDayAnswer = z.enum(["ALREADY_IN_OPENING", "NOT_IN_OPENING"]).optional();
