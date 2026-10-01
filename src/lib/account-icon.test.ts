import { describe, expect, it } from "vitest";

import { accountTile, monogramFor } from "./account-icon";

const bank = (providerName: string) => ({ providerName, accountType: "BANK" });

describe("accountTile", () => {
  it("recognizes the three providers by normalized provider name", () => {
    expect(accountTile(bank("BCA"))).toBe("bca");
    expect(accountTile(bank(" Bank BCA "))).toBe("bca");
    expect(accountTile(bank("Bank Central Asia"))).toBe("bca");
    expect(accountTile({ providerName: "DANA", accountType: "E_WALLET" })).toBe("dana");
    expect(accountTile(bank("Jago"))).toBe("jago");
    expect(accountTile(bank("Jago Syariah"))).toBe("jago");
  });

  it("does not match a different bank that only contains a known name", () => {
    expect(accountTile(bank("BCA Syariah"))).toBeNull();
    expect(accountTile(bank("GoPay"))).toBeNull();
  });

  it("uses the cash glyph for a CASH account whatever its provider name", () => {
    expect(accountTile({ providerName: "Tunai", accountType: "CASH" })).toBe("cash");
    expect(accountTile({ providerName: "DANA", accountType: "CASH" })).toBe("cash");
  });
});

describe("monogramFor", () => {
  it("uses the first letter, upper-cased, and cycles four tones by order", () => {
    expect(monogramFor("  jago", 0)).toEqual({ letter: "J", tone: 1 });
    expect(monogramFor("Tunai", 4)).toEqual({ letter: "T", tone: 1 });
    expect(monogramFor("BCA", 1)).toEqual({ letter: "B", tone: 2 });
  });
  it("keeps a whole emoji instead of half a surrogate pair", () => {
    expect(monogramFor("💰 Dompet", 2)).toEqual({ letter: "💰", tone: 3 });
  });
  it("falls back for an empty name", () => expect(monogramFor("   ", 3)).toEqual({ letter: "?", tone: 4 }));
});
