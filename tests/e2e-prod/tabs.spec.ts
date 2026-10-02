// Production-build tab transitions (PRD v0.22 P10): once the tabs are prefetched, the
// destination page itself slides in with the tab order, in the same commit as the click.
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
  user = await createAuthUser(clients.authAdmin, "e2e-tabs");
  await resetWithConfirmedFixture(clients, user.id, "2026-09-20T20:00:00+07:00");
});

test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

test("a prefetched tab slides in itself", async ({ page }) => {
  const prefetched: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("_rsc")) prefetched.push(new URL(request.url()).pathname);
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();
  await expect.poll(() => prefetched.includes("/rutinitas")).toBe(true);
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    const seen: string[] = ((window as unknown as { __vt: string[] }).__vt = []);
    const start = performance.now();
    const tick = () => {
      for (const animation of document.getAnimations()) {
        const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement ?? "";
        if (pseudo.startsWith("::view-transition")) seen.push(`${(animation as CSSAnimation).animationName}`);
      }
      if (performance.now() - start < 1500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Rutinitas" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Rutinitas" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __vt: string[] }).__vt)).toContain("tab-enter");
  // The page arrived with the click, so no loading skeleton was shown.
  await expect(page.getByText("Memuat…")).toHaveCount(0);
});
