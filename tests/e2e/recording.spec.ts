// Recording forms (PRD: Form dan action behavior): record, Catat lagi, local
// validation, and the cutover-day question, for each recording form.
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
  user = await createAuthUser(clients.authAdmin, "e2e-recording");
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

test("special expense records and Catat lagi clears the form", async ({ page }) => {
  await signIn(page);
  await page.goto("/catat/pengeluaran");
  await page.getByLabel("Nominal").fill("25.000");
  await page.getByRole("button", { name: "Simpan pengeluaran" }).click();
  await expect(page.getByText("Catatan sudah masuk ke Aktivitas dan saldo tercatat.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Lihat catatan" })).toBeVisible();
  await page.getByRole("button", { name: "Catat lagi" }).click();
  await expect(page.getByLabel("Nominal")).toHaveValue("");
});

test("an empty amount keeps the form and names the issue", async ({ page }) => {
  await signIn(page);
  await page.goto("/catat/pengeluaran");
  await page.getByRole("button", { name: "Simpan pengeluaran" }).click();
  await expect(page.getByText("Isi nominal.")).toBeVisible();
  await expect(page.getByLabel("Nominal")).toBeVisible();
});

test("the cutover-day question skips a record already in the opening balance", async ({ page }) => {
  await signIn(page);
  await page.goto("/catat/pengeluaran");
  await page.getByLabel("Nominal").fill("15.000");
  await page.getByLabel("Tanggal").fill(daysAgo(3));
  await page.getByRole("button", { name: "Simpan pengeluaran" }).click();
  await expect(page.getByText("Sudah termasuk saldo awal?")).toBeVisible();
  await page.getByRole("button", { name: "Ya, sudah termasuk" }).click();
  await expect(page.getByText("Tidak dicatat ulang")).toBeVisible();
});

test("transfer records", async ({ page }) => {
  await signIn(page);
  await page.goto("/catat/transfer");
  await page.getByLabel("Nominal transfer").fill("10.000");
  await page.getByRole("button", { name: "Simpan transfer" }).click();
  await expect(page.getByText("Catatan sudah masuk ke Aktivitas dan saldo tercatat.")).toBeVisible();
});

test("dana titipan receipt records", async ({ page }) => {
  await signIn(page);
  await page.goto("/catat/dana-titipan");
  await page.getByLabel("Nominal").fill("10.000");
  await page.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(page.getByText("Catatan sudah masuk ke Aktivitas dan saldo tercatat.")).toBeVisible();
});
