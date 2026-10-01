// Account tile kinds (PRD v0.20 P8). Providers match on the normalized provider
// name, never on the display name or an id; anything unknown gets a monogram.
export type ProviderIcon = "bca" | "dana" | "jago";

const providers: Record<string, ProviderIcon> = {
  bca: "bca",
  bankbca: "bca",
  bankcentralasia: "bca",
  mybca: "bca",
  dana: "dana",
  jago: "jago",
  bankjago: "jago",
  jagosyariah: "jago",
};

export function accountTile(account: { providerName: string; accountType: string }): ProviderIcon | "cash" | null {
  if (account.accountType === "CASH") return "cash";
  return providers[account.providerName.toLowerCase().replace(/[^a-z0-9]/g, "")] ?? null;
}

export function monogramFor(name: string, index: number): { letter: string; tone: 1 | 2 | 3 | 4 } {
  const first = Array.from(name.trim())[0];
  return { letter: first ? first.toUpperCase() : "?", tone: ((index % 4) + 1) as 1 | 2 | 3 | 4 };
}
