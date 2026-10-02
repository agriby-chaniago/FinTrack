import { describe, expect, it } from "vitest";

import { occurrenceStatusIcon } from "./labels";

describe("occurrenceStatusIcon", () => {
  it("shows a clock while waiting, a check once confirmed, and a dash when nothing happened", () => {
    expect(occurrenceStatusIcon).toEqual({ PENDING: "clock", CONFIRMED: "check", NOT_RECEIVED: "minus", NOT_CHARGED: "minus" });
  });
});
