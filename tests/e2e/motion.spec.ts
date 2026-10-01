// Motion surfaces (PRD v0.20 P3): the + Catat sheet, reduced motion, collapses,
// toasts, native disclosures, and the content fade after a skeleton.
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

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

function daysAgo(n: number): string {
  const today = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date())}T00:00:00Z`);
  return new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

test.beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "e2e-motion");
  // Cutover three days ago leaves this month's income and obligations pending.
  await resetWithConfirmedFixture(clients, user.id, `${daysAgo(3)}T20:00:00+07:00`);
});

test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();
}

const identity = /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/;

/** Clicks the visible + Catat button and records the sheet panel's transform every frame for 400 ms. */
function openSheetAndSample(page: Page) {
  return page.evaluate(async () => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Catat" && b.checkVisibility())!;
    button.click();
    const seen: string[] = [];
    const start = performance.now();
    while (performance.now() - start < 400) {
      await new Promise(requestAnimationFrame);
      const panel = document.querySelector("dialog[open] > div");
      if (panel) seen.push(getComputedStyle(panel).transform);
    }
    return seen;
  });
}

test("the + Catat sheet slides in", async ({ page }) => {
  await signIn(page);
  const transforms = await openSheetAndSample(page);
  expect(transforms.some((t) => !identity.test(t))).toBe(true);
  expect(transforms.at(-1)).toMatch(identity);
});

test("Escape closes the sheet and returns focus", async ({ page }) => {
  await signIn(page);
  const button = page.getByRole("button", { name: "Catat" });
  await button.click();
  await expect(page.getByRole("dialog", { name: "Catat" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("reduced motion keeps the sheet still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  const transforms = await openSheetAndSample(page);
  expect(transforms.length).toBeGreaterThan(0);
  expect(transforms.every((t) => identity.test(t))).toBe(true);
});
