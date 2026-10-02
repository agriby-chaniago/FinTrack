// Pengaturan routines (PRD: Monthly flow BCA): ending a rule keeps this month's
// expectation, so the rule shows that it will end instead of plainly active.
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

const todayJakarta = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const currentMonth = () => `${monthNames[Number(todayJakarta().slice(5, 7)) - 1]} ${todayJakarta().slice(0, 4)}`;
const nextMonth = () => {
  const [year, month] = todayJakarta().split("-").map(Number);
  return month === 12 ? `Januari ${year + 1}` : `${monthNames[month]} ${year}`;
};

test.beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "e2e-pengaturan");
  const cutover = new Date(new Date(`${todayJakarta()}T00:00:00Z`).getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
  await resetWithConfirmedFixture(clients, user.id, `${cutover}T20:00:00+07:00`);
});

test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

async function signInToPengaturan(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();
  await page.goto("/pengaturan");
}

test("a saved revision is confirmed even though its form closes", async ({ page }) => {
  await signInToPengaturan(page);
  const row = page.getByRole("listitem").filter({ hasText: "Biaya bulanan bank" });
  await row.getByRole("button", { name: "Ubah perkiraan" }).click();
  await row.getByLabel("Nominal (opsional)").fill("12.000");
  await row.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Perkiraan Biaya bulanan bank diubah mulai ${nextMonth()}` })).toBeVisible();
});

test("ending an obligation this month says it will end, not that it is active", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();
  await page.goto("/pengaturan");

  const row = page.getByRole("listitem").filter({ hasText: "Biaya bulanan bank" });
  await expect(row.getByText("Aktif", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Akhiri" }).click();
  await expect(row.getByText(`Perkiraan ${currentMonth()} tetap ada. Jika tidak terjadi, pilih Tidak ditagih di Rutinitas.`)).toBeVisible();
  await row.getByRole("button", { name: "Akhiri" }).click();

  await expect(row.getByText("Akan berakhir", { exact: true })).toBeVisible();
  await expect(row.getByText("Aktif", { exact: true })).toHaveCount(0);
  await expect(row.getByText(`sampai ${currentMonth()}`)).toBeVisible();
});
