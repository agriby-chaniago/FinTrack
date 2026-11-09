import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((line) => line.includes("=") && !line.startsWith("#")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
Object.assign(process.env, env);
const { asOwner, closeClients, createAuthUser, resetWithConfirmedFixture, testClients } = await import("../helpers/owner");
const { recordOtherEvent } = await import("@/server/application/events");
const { accountBalances } = await import("@/server/application/ledger");
const { listMonthlyCycles, resolveOccurrence } = await import("@/server/application/monthly");
const { businessDateOf } = await import("@/lib/business-time");
const { formatCycle } = await import("@/lib/format");
const clients = testClients();
let user: Awaited<ReturnType<typeof createAuthUser>>;
let reserveId: string;
const today = () => businessDateOf(new Date());
const past = () => new Date(new Date(`${today()}T00:00:00Z`).getTime() - 45 * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async () => { user = await createAuthUser(clients.authAdmin, "e2e-features"); });
test.beforeEach(async () => {
  const owner = await resetWithConfirmedFixture(clients, user.id, `${past()}T20:00:00+07:00`);
  reserveId = owner.accountIds.reserve;
  await asOwner(clients.runtime, user.id, (tx, p) => recordOtherEvent(tx, p.ownerId, { direction: "INCOME", accountId: reserveId, amount: "1000000.17", businessDate: today() }, new Date()));
});
test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  if (user) await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.getByText("Personal cash tercatat", { exact: true })).toBeVisible();
}

test("splitting Jago requires a preview and preserves the recorded total after confirmation", async ({ page }) => {
  const before = await asOwner(clients.runtime, user.id, (tx, p) => accountBalances(tx, p.ownerId));
  await signIn(page);
  await page.goto("/akun");
  await page.getByRole("link", { name: "Pisahkan Jago", exact: true }).click();
  await page.getByLabel("Saldo Jago Utama sekarang", { exact: true }).fill("300.000,03");
  await page.getByRole("button", { name: "Periksa pembagian", exact: true }).click();
  await expect(page.getByRole("region", { name: "Pratinjau pemisahan" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pratinjau pemisahan" })).toContainText("700.000,14");
  const [accountsBefore] = await clients.admin`select count(*)::int as n from fintrack.account`;
  expect(accountsBefore.n).toBe(3);
  await page.getByRole("button", { name: "Konfirmasi pemisahan", exact: true }).click();
  await expect(page).toHaveURL(/\/akun$/);
  await expect(page.getByRole("link").filter({ hasText: "Jago — Utama" })).toContainText("300.000,03");
  await expect(page.getByRole("link").filter({ hasText: "Jago — Tabungan" })).toContainText("700.000,14");
  const after = await asOwner(clients.runtime, user.id, (tx, p) => accountBalances(tx, p.ownerId));
  expect(after.personalCashRecorded).toBe(before.personalCashRecorded);
  await page.reload();
  await expect(page.getByRole("link", { name: "Pisahkan Jago", exact: true })).toHaveCount(0);
});

test("only the current cycle is expanded and history remains reachable from an old task", async ({ page }) => {
  await signIn(page);
  await page.goto("/rutinitas");
  const current = today().slice(0, 7);
  await expect(page.getByRole("heading", { name: formatCycle(current), exact: true })).toBeVisible();
  const history = page.locator("details").filter({ has: page.getByText(/^Riwayat siklus bulanan/) });
  await expect(history).not.toHaveAttribute("open");
  const old = history.locator("[id^='siklus-']").first();
  const oldId = await old.getAttribute("id");
  await expect(old).toBeHidden();
  await history.locator("summary").click();
  await expect(old).toBeVisible();
  await page.goto(`/rutinitas?bulan=${oldId!.replace("siklus-", "")}#${oldId}`);
  await expect(page.locator(`#${oldId}`)).toBeVisible();
});

test("desktop content fills the available width and mobile content does not overflow", async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/akun");
  const box = await page.locator("main").boundingBox();
  expect(box!.width).toBeGreaterThan(1500);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/akun/pisah-jago");
  const bounds = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(bounds.content).toBeLessThanOrEqual(bounds.viewport);
});

test("monthly chart controls change the range and comparison without losing exact data", async ({ page }) => {
  const cutover = new Date(new Date(`${today()}T00:00:00Z`).getTime() - 120 * 86_400_000).toISOString().slice(0, 10);
  await resetWithConfirmedFixture(clients, user.id, `${cutover}T20:00:00+07:00`);
  const cycles = await asOwner(clients.runtime, user.id, (tx, p) => listMonthlyCycles(tx, p.ownerId, new Date()));
  for (const cycle of cycles.toReversed()) {
    if (cycle.income) await asOwner(clients.runtime, user.id, (tx, p) => resolveOccurrence(tx, p.ownerId, "MONTHLY_INCOME", cycle.income!.occurrenceId, { outcome: "NOT_RECEIVED" }, new Date()));
    for (const obligation of cycle.obligations) await asOwner(clients.runtime, user.id, (tx, p) => resolveOccurrence(tx, p.ownerId, "RECURRING_EXPENSE", obligation.occurrenceId, { outcome: "NOT_CHARGED" }, new Date()));
  }
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/aktivitas/laporan");
  await page.getByLabel("Rentang bulan", { exact: true }).selectOption("3");
  await expect(page.getByRole("list", { name: "Data tren bulanan" }).locator("li")).toHaveCount(3);
  await page.getByLabel("Perbandingan bulanan", { exact: true }).selectOption("reserve");
  await expect(page.getByText("Pertumbuhan reserve", { exact: true }).last()).toBeVisible();
  await page.getByLabel("Rentang bulan", { exact: true }).selectOption("12");
  expect(await page.getByRole("list", { name: "Data tren bulanan" }).locator("li").count()).toBeGreaterThan(3);
  await expect(page.locator("canvas[role='img']")).toHaveCount(1);
});
