// Pure onboarding rules (PRD: Saldo awal, Konfigurasi awal yang dibuat onboarding,
// Financial data onboarding flow). No database or framework code here.
import { z } from "zod";

import { addDays, businessDateOf, cycleKeyOf, nextCycleKey } from "@/lib/business-time";
import { MoneyParseError, parseIdrDecimal, toIdrDecimal, type MinorUnits } from "@/lib/money";

import { normalizeName } from "./names";

export const accountKeys = ["reserve", "monthly", "daily"] as const;
export type AccountKey = (typeof accountKeys)[number];

/** Canonical API amount string; syntax is checked here, completeness on confirmation. */
const amountString = z.string().superRefine((value, ctx) => {
  try {
    parseIdrDecimal(value);
  } catch (error) {
    ctx.addIssue({ code: "custom", message: error instanceof MoneyParseError ? error.code : "INVALID_FORMAT" });
  }
});

const expectedDay = z.number().int().min(1).max(31);

export const onboardingDraftSchema = z
  .object({
    cutoverAt: z.iso.datetime({ offset: true }).nullable(),
    accounts: z
      .array(
        z.object({
          key: z.enum(accountKeys),
          displayName: z.string().trim().min(1).max(60),
          providerName: z.string().trim().min(1).max(60),
          accountType: z.enum(["BANK", "E_WALLET"]),
          purposeLabel: z.string().trim().min(1).max(40),
          physicalBalance: amountString.nullable(),
        }),
      )
      .length(3),
    externals: z
      .array(
        z.object({
          accountKey: z.enum(accountKeys),
          subjectName: z.string().max(80),
          amount: amountString.nullable(),
        }),
      )
      .max(20),
    routines: z.object({
      dailyIncome: z.object({ amount: amountString.nullable(), startOnCutoverDay: z.boolean() }),
      monthlyIncome: z.object({ expectedAmount: amountString.nullable(), includeCurrentCycle: z.boolean() }),
      subscriptions: z
        .array(
          z.object({
            name: z.string().max(80),
            expectedDay: expectedDay.nullable(),
            expectedAmount: amountString.nullable(),
            includeCurrentCycle: z.boolean(),
          }),
        )
        .max(20),
      bankFee: z.object({
        expectedDay: expectedDay.nullable(),
        expectedAmount: amountString.nullable(),
        includeCurrentCycle: z.boolean(),
      }),
      retainedFloor: amountString.nullable(),
    }),
  })
  .superRefine((draft, ctx) => {
    const keys = new Set(draft.accounts.map((account) => account.key));
    if (keys.size !== accountKeys.length) {
      ctx.addIssue({ code: "custom", path: ["accounts"], message: "DUPLICATE_ACCOUNT_KEY" });
    }
  });

export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>;

/** Initial draft: Jago/BCA/DANA as data, Rp50.000 daily income, suggested Rp750.000 monthly income. */
export function defaultOnboardingDraft(now: Date): OnboardingDraft {
  return {
    cutoverAt: now.toISOString(),
    accounts: [
      { key: "reserve", displayName: "Jago", providerName: "Jago", accountType: "BANK", purposeLabel: "Reserve", physicalBalance: null },
      { key: "monthly", displayName: "BCA", providerName: "BCA", accountType: "BANK", purposeLabel: "Monthly", physicalBalance: null },
      { key: "daily", displayName: "DANA", providerName: "DANA", accountType: "E_WALLET", purposeLabel: "Daily", physicalBalance: null },
    ],
    externals: [],
    routines: {
      dailyIncome: { amount: "50000", startOnCutoverDay: false },
      monthlyIncome: { expectedAmount: "750000", includeCurrentCycle: false },
      subscriptions: [{ name: "", expectedDay: 5, expectedAmount: null, includeCurrentCycle: false }],
      bankFee: { expectedDay: null, expectedAmount: null, includeCurrentCycle: false },
      retainedFloor: null,
    },
  };
}

export type OnboardingIssueCode =
  | "REQUIRED"
  | "MUST_BE_POSITIVE"
  | "MUST_NOT_BE_NEGATIVE"
  | "CUTOVER_IN_FUTURE"
  | "DUPLICATE_NAME";

export type OnboardingIssue = { readonly path: string; readonly code: OnboardingIssueCode };

const amountOf = (value: string | null): MinorUnits | null => (value === null ? null : parseIdrDecimal(value));

/** Completeness rules checked before `Mulai FinTrack` can confirm the snapshot. */
export function confirmationIssues(draft: OnboardingDraft, now: Date): OnboardingIssue[] {
  const issues: OnboardingIssue[] = [];
  const requirePositive = (path: string, value: string | null) => {
    const amount = amountOf(value);
    if (amount === null) issues.push({ path, code: "REQUIRED" });
    else if (amount <= 0n) issues.push({ path, code: "MUST_BE_POSITIVE" });
  };
  const requireNonNegative = (path: string, value: string | null) => {
    const amount = amountOf(value);
    if (amount === null) issues.push({ path, code: "REQUIRED" });
    else if (amount < 0n) issues.push({ path, code: "MUST_NOT_BE_NEGATIVE" });
  };

  if (!draft.cutoverAt) issues.push({ path: "cutoverAt", code: "REQUIRED" });
  else if (new Date(draft.cutoverAt).getTime() > now.getTime() + 5 * 60_000) {
    issues.push({ path: "cutoverAt", code: "CUTOVER_IN_FUTURE" });
  }

  draft.accounts.forEach((account, index) =>
    requireNonNegative(`accounts.${index}.physicalBalance`, account.physicalBalance),
  );

  const externalKeys = new Set<string>();
  draft.externals.forEach((external, index) => {
    if (!external.subjectName.trim()) issues.push({ path: `externals.${index}.subjectName`, code: "REQUIRED" });
    requirePositive(`externals.${index}.amount`, external.amount);
    const key = `${external.accountKey}:${normalizeName(external.subjectName)}`;
    if (externalKeys.has(key)) issues.push({ path: `externals.${index}.subjectName`, code: "DUPLICATE_NAME" });
    externalKeys.add(key);
  });

  const { routines } = draft;
  requirePositive("routines.dailyIncome.amount", routines.dailyIncome.amount);
  requirePositive("routines.monthlyIncome.expectedAmount", routines.monthlyIncome.expectedAmount);

  const subscriptionNames = new Set<string>();
  routines.subscriptions.forEach((subscription, index) => {
    const name = normalizeName(subscription.name);
    if (!name) issues.push({ path: `routines.subscriptions.${index}.name`, code: "REQUIRED" });
    else if (subscriptionNames.has(name)) {
      issues.push({ path: `routines.subscriptions.${index}.name`, code: "DUPLICATE_NAME" });
    }
    subscriptionNames.add(name);
    if (subscription.expectedDay === null) {
      issues.push({ path: `routines.subscriptions.${index}.expectedDay`, code: "REQUIRED" });
    }
    requirePositive(`routines.subscriptions.${index}.expectedAmount`, subscription.expectedAmount);
  });

  const bankFeeAmount = amountOf(routines.bankFee.expectedAmount);
  if (bankFeeAmount !== null && bankFeeAmount <= 0n) {
    issues.push({ path: "routines.bankFee.expectedAmount", code: "MUST_BE_POSITIVE" });
  }

  requireNonNegative("routines.retainedFloor", routines.retainedFloor);
  return issues;
}

export type AccountReview = {
  readonly key: AccountKey;
  readonly physical: MinorUnits | null;
  readonly external: MinorUnits;
  readonly personal: MinorUnits | null;
  readonly shortfall: MinorUnits | null;
};

export type OnboardingReview = {
  readonly accounts: AccountReview[];
  readonly totals: { physical: MinorUnits; external: MinorUnits; personal: MinorUnits; shortfall: MinorUnits } | null;
  readonly boundaries: {
    readonly cutoverDate: string;
    readonly dailyIncomeStartDate: string;
    readonly monthlyIncomeFirstCycle: string;
    readonly subscriptionFirstCycles: string[];
    readonly bankFeeFirstCycle: string;
  } | null;
};

/**
 * Review shown before confirmation. Personal balance is always derived as
 * physical − external and is signed; it is never clamped to Rp0.
 */
export function reviewOnboarding(draft: OnboardingDraft): OnboardingReview {
  const accounts = draft.accounts.map((account): AccountReview => {
    const external = draft.externals
      .filter((row) => row.accountKey === account.key)
      .reduce((sum, row) => {
        const amount = amountOf(row.amount);
        return amount !== null && amount > 0n ? sum + amount : sum;
      }, 0n);
    const physical = amountOf(account.physicalBalance);
    const personal = physical === null ? null : physical - external;
    const shortfall = personal === null ? null : personal < 0n ? -personal : 0n;
    return { key: account.key, physical, external, personal, shortfall };
  });

  const complete = accounts.every((account) => account.physical !== null);
  const totals = complete
    ? accounts.reduce(
        (sum, account) => ({
          physical: sum.physical + (account.physical ?? 0n),
          external: sum.external + account.external,
          personal: sum.personal + (account.personal ?? 0n),
          shortfall: sum.shortfall + (account.shortfall ?? 0n),
        }),
        { physical: 0n, external: 0n, personal: 0n, shortfall: 0n },
      )
    : null;

  return { accounts, totals, boundaries: draft.cutoverAt ? automationBoundaries(draft, new Date(draft.cutoverAt)) : null };
}

/**
 * Automation boundaries (PRD: Boundary automation setelah onboarding). Daily
 * income starts the day after cutover unless the cutover day is opted in; each
 * monthly rule starts next cycle unless the current cycle is opted in.
 */
export function automationBoundaries(draft: OnboardingDraft, cutoverAt: Date) {
  const cutoverDate = businessDateOf(cutoverAt);
  const currentCycle = cycleKeyOf(cutoverDate);
  const firstCycle = (includeCurrent: boolean) => (includeCurrent ? currentCycle : nextCycleKey(currentCycle));
  const { routines } = draft;
  return {
    cutoverDate,
    dailyIncomeStartDate: routines.dailyIncome.startOnCutoverDay ? cutoverDate : addDays(cutoverDate, 1),
    monthlyIncomeFirstCycle: firstCycle(routines.monthlyIncome.includeCurrentCycle),
    subscriptionFirstCycles: routines.subscriptions.map((subscription) => firstCycle(subscription.includeCurrentCycle)),
    bankFeeFirstCycle: firstCycle(routines.bankFee.includeCurrentCycle),
  };
}

const optionalAmount = (value: MinorUnits | null) => (value === null ? null : toIdrDecimal(value));

/** JSON-safe review for the API: every amount is a canonical decimal string. */
export function serializeReview(review: OnboardingReview) {
  return {
    accounts: review.accounts.map((account) => ({
      key: account.key,
      physical: optionalAmount(account.physical),
      external: toIdrDecimal(account.external),
      personal: optionalAmount(account.personal),
      shortfall: optionalAmount(account.shortfall),
    })),
    totals: review.totals && {
      physical: toIdrDecimal(review.totals.physical),
      external: toIdrDecimal(review.totals.external),
      personal: toIdrDecimal(review.totals.personal),
      shortfall: toIdrDecimal(review.totals.shortfall),
    },
    boundaries: review.boundaries,
  };
}
