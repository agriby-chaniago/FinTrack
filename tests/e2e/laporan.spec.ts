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
