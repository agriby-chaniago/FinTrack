import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((line) => line.includes("=") && !line.startsWith("#")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
Object.assign(process.env, env);
const { asOwner, closeClients, createAuthUser, resetWithConfirmedFixture, testClients } = await import("../helpers/owner");
const { createOrReuseCategory, recordSpecialExpense } = await import("@/server/application/events");
const { correctEntry } = await import("@/server/application/corrections");
const { createSettlementDraft, settle } = await import("@/server/application/settlement");
const { monthReport } = await import("@/server/application/reports");

const clients = testClients();
let user: Awaited<ReturnType<typeof createAuthUser>>;
let entryId: string;
let categoryId: string;

test.beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "e2e-corrections");
  const owner = await resetWithConfirmedFixture(clients, user.id, "2026-08-02T20:00:00+07:00");
  const original = await asOwner(clients.runtime, user.id, (tx, p) => recordSpecialExpense(tx, p.ownerId, {
    amount: "10000", sourceAccountId: owner.accountIds.daily, newCategoryName: "Kategori awal", businessDate: "2026-08-05",
  }, new Date()));
  if (!original.recorded) throw new Error("Fixture expense was not posted");
  entryId = original.entryId;
  await asOwner(clients.runtime, user.id, async (tx, p) => {
    const draft = await createSettlementDraft(tx, p.ownerId, { endDate: "2026-08-09", closingPhysicalBalance: "110000", closingAt: "2026-08-09T21:00:00+07:00" }, new Date());
    await settle(tx, p.ownerId, draft.id, draft.version, new Date());
  });
  categoryId = await asOwner(clients.runtime, user.id, (tx, p) => createOrReuseCategory(tx, p.ownerId, "Kategori benar"));
  await asOwner(clients.runtime, user.id, (tx, p) => correctEntry(tx, p.ownerId, entryId, { action: "REPLACE", amount: "15000", categoryId, businessDate: "2026-08-05" }, new Date()));
});

test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  if (user) await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

test("a settled expense can be corrected again with its current amount and category", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.getByText("Personal cash tercatat", { exact: true })).toBeVisible();
  await page.goto(`/aktivitas/${entryId}`);
  await expect(page.getByLabel("Nominal yang benar")).toHaveValue("15.000");
  await expect(page.getByLabel("Kategori", { exact: true })).toHaveValue(categoryId);
  await page.getByLabel("Nominal yang benar").fill("12.000");
  await page.getByRole("button", { name: "Simpan koreksi", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/aktivitas/${entryId}$`));
  await expect(page.getByLabel("Nominal yang benar")).toHaveValue("12.000");
  await expect(page.getByRole("button", { name: "Simpan koreksi", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Nominal yang benar")).toHaveValue("12.000");
  await expect(page.getByLabel("Kategori", { exact: true })).toHaveValue(categoryId);
  const report = await asOwner(clients.runtime, user.id, (tx, p) => monthReport(tx, p.ownerId, "2026-08", "corrected", new Date()));
  expect(report.outflow.special).toBe("12000");
  expect(report.outflow.specialByCategory.find((c) => c.categoryId === categoryId)?.amount).toBe("12000");
});
