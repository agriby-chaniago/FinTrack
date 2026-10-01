import { describe, expect, it, vi } from "vitest";

import type { DigestOutcome } from "@/server/application/reminders";

import { handleReminder } from "./reminder";

const request = (token?: string) => new Request("https://fintrack.example/api/internal/reminders", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });
const deps = (deliver = vi.fn(async (): Promise<DigestOutcome> => "SENT")) => ({ environment: "production", expectedToken: "secret-token", deliver });

describe("handleReminder", () => {
  it("is unavailable outside production", async () => {
    expect((await handleReminder(request("secret-token"), { ...deps(), environment: "preview" })).status).toBe(404);
  });

  it("rejects a wrong token before delivering", async () => {
    const d = deps();
    expect((await handleReminder(request("nope"), d)).status).toBe(401);
    expect((await handleReminder(request(), d)).status).toBe(401);
    expect(d.deliver).not.toHaveBeenCalled();
  });

  it("reports the outcome", async () => {
    const response = await handleReminder(request("secret-token"), deps());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: "SENT" } });
  });

  it("answers 503 without a bound owner and 502 when Telegram fails", async () => {
    expect((await handleReminder(request("secret-token"), deps(vi.fn(async (): Promise<DigestOutcome> => "NO_OWNER")))).status).toBe(503);
    const failing = vi.fn(async (): Promise<DigestOutcome> => {
      throw new Error("TELEGRAM_500");
    });
    const response = await handleReminder(request("secret-token"), deps(failing));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("api.telegram.org");
  });

  it("needs a configured token", async () => {
    expect((await handleReminder(request("x"), { ...deps(), expectedToken: undefined })).status).toBe(500);
  });
});
