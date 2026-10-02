// Motion that remembers this session (PRD v0.22 P10): amounts that changed since they were
// last seen roll like an odometer, and tasks that were done elsewhere are checked off on
// return to Beranda. A full page load starts without memory and replays nothing.
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
  user = await createAuthUser(clients.authAdmin, "e2e-memory");
});

// Every test starts from the same fixture: this month's income is still pending.
test.beforeEach(async () => {
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

/** Records a Rp25.000 special expense through + Catat and returns to Beranda, all client-side. */
async function spendThroughCatat(page: Page) {
  await page.getByRole("button", { name: "Catat" }).click();
  await page.getByRole("dialog", { name: "Catat" }).getByRole("link", { name: /Pengeluaran khusus/ }).click();
  await page.getByLabel("Nominal").fill("25.000");
  await page.getByRole("button", { name: "Simpan pengeluaran" }).click();
  await expect(page.getByText("Catatan sudah masuk ke Aktivitas dan saldo tercatat.")).toBeVisible();
  await page.getByRole("link", { name: "Ke Beranda" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();
}

const jagoAmount = (page: Page) => page.locator("main a[href^='/akun/']").filter({ hasText: "Jago" }).first().locator("[data-rolling]");

/** Counts every rolling overlay added to the page from now on (runs before each document). */
function countOverlays(page: Page) {
  return page.addInitScript(() => {
    const seen = ((window as unknown as { __overlays: number }).__overlays = 0);
    void seen;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.classList.contains("odo-overlay")) (window as unknown as { __overlays: number }).__overlays += 1;
        }
      }
    }).observe(document, { subtree: true, childList: true });
  });
}
const overlays = (page: Page) => page.evaluate(() => (window as unknown as { __overlays: number }).__overlays);

test.describe("rolling amounts", () => {
  test("a changed balance rolls and keeps the exact amount in the DOM", async ({ page }) => {
    await signIn(page);
    const before = await jagoAmount(page).textContent();
    await spendThroughCatat(page);
    const amount = jagoAmount(page);
    await expect(amount.locator(".odo-overlay")).toHaveCount(1);
    await expect(page.locator("[data-count-up] .odo-overlay")).toHaveCount(1);
    const during = await amount.textContent();
    expect(during).not.toBe(before);
    await expect(amount.locator(".odo-overlay")).toHaveCount(0, { timeout: 4000 });
    expect(await amount.textContent()).toBe(during);
    // The headline rolls to its new value instead of counting up from Rp0.
    expect(await page.locator("[data-count-up]").textContent()).not.toBe("Rp0");
  });

  test("a full page load never rolls", async ({ page }) => {
    await countOverlays(page);
    await signIn(page);
    await spendThroughCatat(page);
    await page.goto("/");
    await expect(page.getByText("Personal cash tercatat")).toBeVisible();
    await page.waitForTimeout(1500);
    // Only the client-side return above may roll; the full load starts without memory.
    expect(await overlays(page)).toBe(0);
  });

  test("reduced motion never rolls", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page);
    await spendThroughCatat(page);
    await page.waitForTimeout(300);
    await expect(page.locator(".odo-overlay")).toHaveCount(0);
  });
});

test.describe("finished tasks", () => {
  const nav = (page: Page) => page.getByRole("navigation", { name: "Navigasi utama" });
  const celebrated = (page: Page) => page.locator("section[aria-labelledby='tasks-title'] .celebrate");

  test("a task finished in Rutinitas flashes there and is checked off on return to Beranda", async ({ page }) => {
    await signIn(page);
    await nav(page).getByRole("link", { name: "Rutinitas" }).click();
    await page.getByRole("button", { name: /^Konfirmasi sesuai saran · Rp750\.000/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Income bulanan dikonfirmasi" })).toBeVisible();
    // The occurrence that was just confirmed flashes green with a drawn check.
    expect(await page.locator(".celebrate").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("flash-success");

    await nav(page).getByRole("link", { name: "Beranda" }).click();
    const row = celebrated(page).filter({ hasText: "Konfirmasi income bulanan" });
    await expect(row).toHaveCount(1);
    // The replay is decoration: its whole list item is hidden from screen readers.
    await expect(row.locator("xpath=..")).toHaveAttribute("aria-hidden", "true");
    expect(await row.locator("svg path").evaluate((el) => getComputedStyle(el).animationName)).toBe("draw");
    expect(await row.locator(".celebrate-strike").evaluate((el) => getComputedStyle(el).animationName)).toBe("strike");
    await expect(row).toHaveCount(0, { timeout: 5000 });
  });

  test("a full page load replays no finished task", async ({ page }) => {
    await signIn(page);
    await nav(page).getByRole("link", { name: "Rutinitas" }).click();
    await page.getByRole("button", { name: /^Konfirmasi sesuai saran · Rp750\.000/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Income bulanan dikonfirmasi" })).toBeVisible();
    await page.goto("/");
    await expect(page.getByText("Personal cash tercatat")).toBeVisible();
    await page.waitForTimeout(800);
    await expect(celebrated(page)).toHaveCount(0);
  });

  test("reduced motion replays no finished task", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page);
    await nav(page).getByRole("link", { name: "Rutinitas" }).click();
    await page.getByRole("button", { name: /^Konfirmasi sesuai saran · Rp750\.000/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Income bulanan dikonfirmasi" })).toBeVisible();
    await nav(page).getByRole("link", { name: "Beranda" }).click();
    await expect(page.getByText("Personal cash tercatat")).toBeVisible();
    await page.waitForTimeout(800);
    await expect(celebrated(page)).toHaveCount(0);
  });

  test("the last finished tasks still celebrate before the list goes away", async ({ page, playwright }) => {
    await signIn(page);
    await nav(page).getByRole("link", { name: "Rutinitas" }).click();
    await page.getByRole("button", { name: "Tidak diterima", exact: true }).click();
    await expect(page.getByRole("button", { name: "Tidak diterima", exact: true })).toHaveCount(0);
    const notCharged = page.getByRole("button", { name: "Tidak ditagih", exact: true });
    for (let remaining = 2; remaining > 0; remaining -= 1) {
      await expect(notCharged).toHaveCount(remaining);
      await notCharged.first().click();
    }
    await expect(notCharged).toHaveCount(0);
    // Resolving the cycle asks to check the Jago and BCA balances; confirm them unchanged so no task is left.
    const api = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3000" });
    const headers = () => ({ authorization: `Bearer ${user.accessToken}`, "idempotency-key": crypto.randomUUID() });
    const accounts: { id: string; displayName: string; physical: string }[] = (await (await api.get("/api/v1/accounts", { headers: headers() })).json()).data.accounts;
    for (const account of accounts.filter((a) => a.displayName === "Jago" || a.displayName === "BCA")) {
      const confirmed = await api.post("/api/v1/balance-confirmations", { headers: headers(), data: { accountId: account.id, physicalBalance: account.physical } });
      expect(confirmed.ok()).toBe(true);
    }
    await api.dispose();
    await nav(page).getByRole("link", { name: "Beranda" }).click();
    await expect(celebrated(page)).toHaveCount(3);
    await expect(page.locator("section[aria-labelledby='tasks-title']")).toHaveCount(0, { timeout: 6000 });
  });
});
