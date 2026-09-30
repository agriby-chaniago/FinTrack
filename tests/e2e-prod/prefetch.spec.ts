// Production-build behaviour (prefetching only runs in production): the main
// tabs are prefetched with their data, and saving a change purges every
// prefetched page so no tab shows balances from before the change.
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
  user = await createAuthUser(clients.authAdmin, "e2e-prefetch");
  await resetWithConfirmedFixture(clients, user.id, "2026-09-20T20:00:00+07:00");
});

test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

const total = async (page: import("@playwright/test").Page) =>
  (await page.locator("main").innerText()).match(/Total uang pribadi tercatat (Rp[\d.,]+)/)?.[1];

test("prefetched tabs open without a request, and saving purges them", async ({ page }) => {
  const dataRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("_rsc")) dataRequests.push(new URL(request.url()).pathname);
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();
  await expect.poll(() => dataRequests.filter((path) => ["/rutinitas", "/aktivitas", "/akun"].includes(path)).length).toBeGreaterThanOrEqual(3);

  const nav = page.getByRole("navigation", { name: "Navigasi utama" });
  dataRequests.length = 0;
  await nav.getByRole("link", { name: "Akun" }).click();
  await expect(page.getByText("Total uang pribadi tercatat")).toBeVisible();
  expect(dataRequests).not.toContain("/akun");
  const before = await total(page);

  await page.goto("/catat/pengeluaran");
  await page.getByLabel("Nominal").fill("10.000");
  await page.getByLabel("Kategori").selectOption({ label: "Lainnya…" });
  await page.getByLabel("Nama kategori baru").fill("Tes");
  await page.getByLabel("Dibayar dari").selectOption({ label: "BCA" });
  await page.getByRole("button", { name: "Simpan pengeluaran" }).click();
  await expect(page.getByText("Tersimpan", { exact: true })).toBeVisible();

  await nav.getByRole("link", { name: "Akun" }).click();
  await expect(page.getByText("Total uang pribadi tercatat")).toBeVisible();
  expect(await total(page)).not.toBe(before);
});
