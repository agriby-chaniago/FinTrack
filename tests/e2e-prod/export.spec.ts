import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { expectExportPair } from "../helpers/export-downloads";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((line) => line.includes("=") && !line.startsWith("#")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
Object.assign(process.env, env);
const { closeClients, createAuthUser, resetWithConfirmedFixture, testClients } = await import("../helpers/owner");
const clients = testClients();
let user: Awaited<ReturnType<typeof createAuthUser>>;

test.beforeAll(async () => {
  user = await createAuthUser(clients.authAdmin, "e2e-export");
  await resetWithConfirmedFixture(clients, user.id, "2026-09-20T20:00:00+07:00");
});
test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

test("production downloads the companion CSV and full ZIP from one snapshot", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();
  await page.goto("/pengaturan");
  await expectExportPair(page);
});
