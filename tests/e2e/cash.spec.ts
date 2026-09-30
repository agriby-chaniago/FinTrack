// Tunai through the settlement UI (PRD v0.19): the first settlement starts
// tracking the wallet, the next one counts it, and the account appears in Akun.
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

/** A Sunday at least two full weeks before today (Asia/Jakarta), so two settlements are due. */
function pastSunday(): string {
  const today = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date())}T00:00:00Z`);
  const date = new Date(today.getTime() - 15 * 86_400_000);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

test.beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "e2e-cash");
  await resetWithConfirmedFixture(clients, user.id, `${pastSunday()}T20:00:00+07:00`);
});

test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

test("the owner starts tracking cash at a settlement and counts the wallet the next week", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();

  await test.step("week 1 starts tracking cash", async () => {
    await page.goto("/rutinitas/settlement");
    await page.getByLabel("Saldo DANA saat penutupan").fill("100.000");
    await page.getByLabel("Mulai lacak uang tunai").check();
    await page.getByLabel("Uang tunai di dompet sekarang").fill("20.000");
    await page.getByRole("button", { name: "Lihat hasil settlement" }).click();
    await expect(page.getByRole("heading", { name: "Hasil rekonstruksi" })).toBeVisible();
    await expect(page.getByText(/Tunai mulai dilacak dengan/)).toBeVisible();
    // 0 + 350.000 − 100.000; the wallet is not in this settlement yet.
    await expect(page.locator("dd", { hasText: /^Rp250\.000$/ }).first()).toBeVisible();
    await page.getByRole("button", { name: "Selesaikan settlement" }).click();
    await expect(page.getByText("Tunai mulai dilacak", { exact: true })).toBeVisible();
  });

  await test.step("week 2 counts the wallet", async () => {
    await page.goto("/rutinitas/settlement");
    await page.getByLabel("Saldo DANA saat penutupan").fill("50.000");
    await page.getByLabel("Uang tunai di dompet").fill("30.000");
    await page.getByRole("button", { name: "Lihat hasil settlement" }).click();
    await expect(page.getByText("+ Uang tunai awal periode")).toBeVisible();
    // 100.000 + 20.000 + 350.000 − 50.000 − 30.000
    await expect(page.locator("dd", { hasText: /^Rp390\.000$/ }).first()).toBeVisible();
    await page.getByRole("button", { name: "Selesaikan settlement" }).click();
    await expect(page).toHaveURL(/\/rutinitas\/settlement\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Hasil settlement" })).toBeVisible();
  });

  await test.step("Tunai is an account with the counted wallet", async () => {
    await page.goto("/akun");
    const card = page.getByRole("link", { name: /^Tunai/ });
    await expect(card).toContainText("Rp30.000");
  });
});
