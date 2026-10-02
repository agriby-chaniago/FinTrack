// Daily income exceptions (PRD: Daily income DANA, correction after settlement):
// a day in the open week is a plain exception; a day in a settled week is saved
// as a correction that keeps the as-settled snapshot.
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

const todayJakarta = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const addDaysIso = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** The Sunday at least `weeks` full weeks before today (Asia/Jakarta). */
function sundayWeeksAgo(weeks: number): string {
  const date = new Date(new Date(`${todayJakarta()}T00:00:00Z`).getTime() - weeks * 7 * 86_400_000);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

const cutover = sundayWeeksAgo(2);
const settledDay = addDaysIso(cutover, 3);

test.beforeAll(async ({ playwright }) => {
  user = await createAuthUser(clients.authAdmin, "e2e-daily-income");
  await resetWithConfirmedFixture(clients, user.id, `${cutover}T20:00:00+07:00`);
  // Settle the first week, so settledDay belongs to a SETTLED settlement.
  const api = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3000" });
  const headers = (ifMatch?: number) => ({ authorization: `Bearer ${user.accessToken}`, "idempotency-key": crypto.randomUUID(), ...(ifMatch === undefined ? {} : { "if-match": `"${ifMatch}"` }) });
  const endDate = addDaysIso(cutover, 7);
  const created = (await (await api.post("/api/v1/settlements", { headers: headers(), data: { endDate } })).json()).data;
  const patched = (await (await api.patch(`/api/v1/settlements/${created.id}`, { headers: headers(created.version), data: { closingPhysicalBalance: "100000", closingAt: `${endDate}T21:00:00+07:00` } })).json()).data;
  expect((await api.post(`/api/v1/settlements/${created.id}/settle`, { headers: headers(patched.version), data: {} })).ok()).toBe(true);
  await api.dispose();
});

test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

async function openExceptionForm(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();
  await page.goto("/rutinitas");
  const form = page.locator("details", { hasText: "Income harian hari tertentu berbeda?" });
  await form.locator("summary").click();
  return form;
}

test("a day in a settled week can be corrected", async ({ page }) => {
  const form = await openExceptionForm(page);
  const date = form.getByLabel("Tanggal", { exact: true });
  expect((await date.getAttribute("min"))! <= settledDay).toBe(true);
  await date.fill(settledDay);
  await expect(form.getByText("Tanggal ini sudah masuk settlement.")).toBeVisible();
  await form.getByRole("button", { name: "Simpan koreksi" }).click();
  await expect(form.getByText("Koreksi tersimpan.")).toBeVisible();
});

test("a day in the open week stays a plain exception", async ({ page }) => {
  const form = await openExceptionForm(page);
  await form.getByLabel("Tanggal", { exact: true }).fill(todayJakarta());
  await expect(form.getByText("Tanggal ini sudah masuk settlement.")).toHaveCount(0);
  await form.getByRole("button", { name: "Simpan pengecualian" }).click();
  await expect(form.getByText("Tersimpan.", { exact: true })).toBeVisible();
});
