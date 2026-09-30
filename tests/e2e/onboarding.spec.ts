// Owner signs in through the real login form and completes financial onboarding
// on a phone-sized viewport (PRD: Financial data onboarding flow).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

const admin = postgres(env.ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
const authAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `e2e-${randomUUID()}@fintrack.test`;
const password = `pw-${randomUUID()}`;
let userId = "";

test.beforeAll(async () => {
  const created = await authAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  await admin`truncate fintrack.app_owner cascade`;
  await admin`insert into fintrack.app_owner (auth_user_id, bound_at) values (${userId}, now())`;
});

test.afterAll(async () => {
  await admin`truncate fintrack.app_owner cascade`;
  await authAdmin.auth.admin.deleteUser(userId);
  await admin.end();
});

test("owner signs in and completes onboarding with the locked fixture", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText("Langkah 1 dari 5")).toBeVisible();

  await page.getByRole("button", { name: "Simpan & lanjut" }).click();
  await expect(page.getByRole("heading", { name: "Saldo di setiap akun" })).toBeVisible();
  await page.getByLabel("Saldo Jago").fill("0");
  await page.getByLabel("Saldo BCA").fill("831.999,93");
  await page.getByLabel("Saldo DANA").fill("0");
  await expect(page.getByLabel("Saldo BCA")).toHaveValue("831.999,93");
  await page.getByRole("button", { name: "Simpan & lanjut" }).click();

  await page.getByLabel("Ada uang milik orang lain").check();
  await page.getByRole("button", { name: "+ Tambah pemilik dana" }).click();
  await page.getByLabel("Pemilik dana").fill("Dosen");
  await page.getByLabel("Jumlah").fill("431999,93");
  await expect(page.getByLabel("Jumlah")).toHaveValue("431.999,93");
  await page.getByRole("button", { name: "Simpan & lanjut" }).click();

  await expect(page.getByRole("heading", { name: "Rutinitas awal" })).toBeVisible();
  await page.getByLabel("Nama subscription").fill("Langganan");
  await page.getByLabel("Perkiraan nominal", { exact: true }).fill("400.000");
  await page.getByRole("button", { name: "Simpan & lanjut" }).click();

  // The floor was skipped on purpose: confirmation must send the owner back to it.
  await expect(page.getByRole("heading", { name: "Tinjau sebelum mulai" })).toBeVisible();
  await expect(page.getByText("Total uang pribadi")).toBeVisible();
  await page.getByRole("button", { name: "Mulai FinTrack" }).click();
  await expect(page.getByRole("heading", { name: "Rutinitas awal" })).toBeVisible();
  await expect(page.getByText("Masih ada isian yang perlu dilengkapi.")).toBeVisible();
  await expect(page.getByText("Wajib diisi.")).toBeVisible();

  await page.getByLabel("Saldo minimum ditahan").fill("400.000");
  await page.getByRole("button", { name: "Simpan & lanjut" }).click();
  const total = page.locator("div", { hasText: /^Total uang pribadi/ }).last();
  await expect(total).toContainText("Rp400.000");
  await page.getByRole("button", { name: "Mulai FinTrack" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Onboarding selesai.")).toBeVisible();

  const [{ accounts, personal }] = await admin<{ accounts: string; personal: string }[]>`
    select (select count(*) from fintrack.account)::text as accounts,
           ((select sum(physical_balance_minor) from fintrack.opening_account_position)
            - (select sum(amount_minor) from fintrack.opening_external_position))::text as personal`;
  expect({ accounts, personal }).toEqual({ accounts: "3", personal: "40000000" });
});
