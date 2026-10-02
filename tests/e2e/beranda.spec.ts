// Beranda density (PRD v0.20 P2, P4, P7, P8): provider icons, week strip,
// chart eligibility with text, and square shapes.
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

function daysAgo(n: number): string {
  const today = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date())}T00:00:00Z`);
  return new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

test.beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "e2e-beranda");
  // Income starts the day after cutover, so the open DANA week always includes today.
  await resetWithConfirmedFixture(clients, user.id, `${daysAgo(3)}T20:00:00+07:00`);
});

test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

test("Beranda shows provider icons, the week strip, and chart eligibility, all square", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();

  for (const provider of ["jago", "bca", "dana"]) await expect(page.locator(`main img[src*="${provider}"]`).first()).toBeVisible();

  const strip = page.getByRole("list", { name: "Income harian minggu berjalan" });
  await expect(strip).toBeVisible();
  await expect(strip.getByRole("listitem").first()).toHaveAccessibleName(/^(Sen|Sel|Rab|Kam|Jum|Sab|Min) /);

  await expect(page.getByRole("progressbar", { name: "Kelayakan tren mingguan" })).toBeVisible();
  await expect(page.getByText(/\d\/4 settlement/)).toBeVisible();

  const card = page.locator("main a[href^='/akun/']").first();
  expect(await card.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("0px");
});

test("account names stay readable next to a long status badge on desktop", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();
  // A special expense from Jago after its confirmation gives Jago the longest badge.
  await page.goto("/catat/pengeluaran");
  await page.getByLabel("Nominal").fill("12.000");
  await page.getByRole("button", { name: "Simpan pengeluaran" }).click();
  await expect(page.getByText("Catatan sudah masuk ke Aktivitas dan saldo tercatat.")).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByText("Terhitung setelah konfirmasi").first()).toBeVisible();
  const cards = page.locator("section[aria-labelledby='accounts-title'] a");
  for (let i = 0; i < (await cards.count()); i++) {
    const layout = await cards.nth(i).evaluate((card) => {
      const name = card.querySelector("p.font-medium") as HTMLElement;
      const badge = [...card.querySelectorAll("span")].find((s) => s.className.includes("rounded") || s.className.includes("bg-")) as HTMLElement;
      const a = name.getBoundingClientRect();
      const b = badge.getBoundingClientRect();
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return { truncated: name.scrollWidth > name.clientWidth, overlap, text: name.textContent };
    });
    expect(layout, `card ${layout.text}`).toEqual({ truncated: false, overlap: false, text: layout.text });
  }
});
