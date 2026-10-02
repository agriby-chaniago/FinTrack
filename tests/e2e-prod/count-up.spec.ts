// Production-build behaviour of the headline count-up (PRD v0.21 P9): the inline
// script is a serialized function, so it must survive server minification and
// count up before the first paint, never showing the exact amount first.
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
Object.assign(process.env, env);
const { closeClients, createAuthUser, resetWithConfirmedFixture, testClients } = await import("../helpers/owner");

const clients = testClients();
let user: Awaited<ReturnType<typeof createAuthUser>>;

test.beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "e2e-count-up");
  await resetWithConfirmedFixture(clients, user.id, "2026-09-20T20:00:00+07:00");
});

test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

type Recorder = { __headline: string[] };

test("a full page load counts the headline up from Rp0 without a flash", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();

  await page.addInitScript(() => {
    const seen: string[] = ((window as unknown as Recorder).__headline = []);
    new MutationObserver(() => {
      // Only what a person can see: a streamed boundary stays hidden until React reveals it.
      const el = document.querySelector("[data-count-up]");
      const text = el && el.getClientRects().length > 0 ? el.textContent : null;
      if (text && text !== seen.at(-1)) seen.push(text);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto("/");
  const headline = page.locator("[data-count-up]");
  const minor = BigInt((await headline.getAttribute("data-count-up"))!);
  const exact = `${minor / 100n}${minor % 100n === 0n ? "" : (minor % 100n).toString().padStart(2, "0")}`;
  await expect.poll(async () => (await headline.textContent())?.replace(/\D/g, "")).toBe(exact);

  const texts = await page.evaluate(() => (window as unknown as Recorder).__headline);
  expect(texts[0]).toBe("Rp0");
  expect(texts.length).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});
