import { describe, expect, it, vi } from "vitest";

import { telegramSender } from "./telegram";

describe("telegramSender", () => {
  it("posts the text to the configured chat without link previews", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await telegramSender("123:abc", "42", fetchImpl as unknown as typeof fetch)("halo");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: "42", text: "halo", disable_web_page_preview: true });
  });

  it("throws a code that carries neither the token nor the URL", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(telegramSender("123:abc", "42", fetchImpl as unknown as typeof fetch)("halo")).rejects.toThrow(/^TELEGRAM_401$/);
    const unreachable = vi.fn(async () => {
      throw new TypeError("fetch failed https://api.telegram.org/bot123:abc/sendMessage");
    });
    await expect(telegramSender("123:abc", "42", unreachable as unknown as typeof fetch)("halo")).rejects.toThrow(/^TELEGRAM_UNREACHABLE$/);
    await expect(telegramSender(undefined, "42")("halo")).rejects.toThrow("TELEGRAM_NOT_CONFIGURED");
  });
});
