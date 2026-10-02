// Laporan (PRD v0.20 P4, P5): the Riwayat | Laporan switch, the month report,
// month navigation, and the trend charts that appear only when eligible.
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
type User = Awaited<ReturnType<typeof createAuthUser>>;

const todayJakarta = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
function daysAgo(n: number): string {
  return new Date(new Date(`${todayJakarta()}T00:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
function jakartaMonth(offset: number): string {
  const [y, m] = todayJakarta().split("-").map(Number);
  const index = y * 12 + (m - 1) + offset;
  return `${monthNames[index % 12]} ${Math.floor(index / 12)}`;
}
const currentMonthLabel = () => jakartaMonth(0);
const previousMonthLabel = () => jakartaMonth(-1);

async function signInAs(page: Page, user: User) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();
}

test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await closeClients(clients);
});

test.describe("a new owner", () => {
  let user: User;
  test.beforeAll(async () => {
    user = await createAuthUser(clients.authAdmin, "e2e-laporan");
    // Cutover 40 days ago: the previous month always has daily income; no settlement is recorded.
    await resetWithConfirmedFixture(clients, user.id, `${daysAgo(40)}T20:00:00+07:00`);
  });
  test.afterAll(async () => {
    await clients.authAdmin.auth.admin.deleteUser(user.id);
  });

  test("Aktivitas switches to Laporan and shows the month", async ({ page }) => {
    await signInAs(page, user);
    await page.goto("/aktivitas");
    await page.getByRole("link", { name: "Laporan" }).click();
    await expect(page).toHaveURL(/\/aktivitas\/laporan$/);
    await expect(page.getByRole("link", { name: "Laporan" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: currentMonthLabel() })).toBeVisible();
    await expect(page.getByText("Pemasukan").first()).toBeVisible();
    await expect(page.getByText("0/4 settlement")).toBeVisible();
  });

  test("an invalid month falls back to the current month", async ({ page }) => {
    await signInAs(page, user);
    await page.goto("/aktivitas/laporan?bulan=2099-01");
    await expect(page.getByRole("heading", { name: currentMonthLabel() })).toBeVisible();
    await page.goto("/aktivitas/laporan?bulan=garbage");
    await expect(page.getByRole("heading", { name: currentMonthLabel() })).toBeVisible();
  });

  test("the previous-month link opens that month", async ({ page }) => {
    await signInAs(page, user);
    await page.goto("/aktivitas/laporan");
    await page.getByRole("link", { name: /Bulan sebelumnya/ }).click();
    await expect(page.getByRole("heading", { name: previousMonthLabel() })).toBeVisible();
  });
});

/** The Sunday at least `weeks` full weeks before today (Asia/Jakarta). */
function sundayWeeksAgo(weeks: number): string {
  const date = new Date(new Date(`${todayJakarta()}T00:00:00Z`).getTime() - weeks * 7 * 86_400_000);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}
const addDaysIso = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

test.describe("with four settled weeks", () => {
  let user: User;
  test.beforeAll(async ({ playwright }) => {
    user = await createAuthUser(clients.authAdmin, "e2e-laporan-trend");
    const cutover = sundayWeeksAgo(5);
    await resetWithConfirmedFixture(clients, user.id, `${cutover}T20:00:00+07:00`);
    const api = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3000" });
    const headers = (ifMatch?: number) => ({ authorization: `Bearer ${user.accessToken}`, "idempotency-key": crypto.randomUUID(), ...(ifMatch === undefined ? {} : { "if-match": `"${ifMatch}"` }) });
    for (let week = 1; week <= 4; week++) {
      const endDate = addDaysIso(cutover, week * 7);
      const created = (await (await api.post("/api/v1/settlements", { headers: headers(), data: { endDate } })).json()).data;
      const patched = (await (await api.patch(`/api/v1/settlements/${created.id}`, { headers: headers(created.version), data: { closingPhysicalBalance: "100000", closingAt: `${endDate}T21:00:00+07:00` } })).json()).data;
      const settled = await api.post(`/api/v1/settlements/${created.id}/settle`, { headers: headers(patched.version), data: {} });
      expect(settled.ok()).toBe(true);
    }
    await api.dispose();
  });
  test.afterAll(async () => {
    await clients.authAdmin.auth.admin.deleteUser(user.id);
  });

  test("desktop shows charts only when eligible, mobile shows the data list", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await signInAs(page, user);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/aktivitas/laporan");
    // Weekly is eligible after four settlements; monthly needs three completed BCA cycles.
    await expect(page.locator("canvas[role='img']")).toHaveCount(1);
    await expect(page.locator("canvas[role='img']")).toHaveAttribute("aria-label", /per hari/);
    // The line draws in over 700 ms (PRD v0.21 P9); its animation callbacks must not throw.
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.reload();
    await expect(page.getByRole("list", { name: "Data tren mingguan" })).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
  });
});
