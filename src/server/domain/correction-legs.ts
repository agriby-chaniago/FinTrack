import type { LedgerLeg } from "./ledger";

/** Category is part of an expense's effect: moving it must reverse the old category. */
export type CorrectionLeg = LedgerLeg & { readonly categoryId: string | null };

/** Net effects of one correction family, preserving account, holding, and category. */
export function combineCorrectionLegs(legs: readonly CorrectionLeg[]): CorrectionLeg[] {
  const totals = new Map<string, CorrectionLeg>();
  for (const leg of legs) {
    const key = JSON.stringify([leg.accountId, leg.holdingId, leg.categoryId]);
    const previous = totals.get(key);
    totals.set(key, {
      ...leg,
      physicalEffect: (previous?.physicalEffect ?? 0n) + leg.physicalEffect,
      externalEffect: (previous?.externalEffect ?? 0n) + leg.externalEffect,
    });
  }
  return [...totals.values()].filter((leg) => leg.physicalEffect !== 0n || leg.externalEffect !== 0n);
}
