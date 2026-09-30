// Owner signs in through the real login form and completes financial onboarding
// on a phone-sized viewport (PRD: Financial data onboarding flow).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { databaseSsl } from "@/server/db/supabase-ca";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

const admin = postgres(env.ADMIN_DATABASE_URL, { ssl: databaseSsl(env.ADMIN_DATABASE_URL), max: 1, onnotice: () => {} });
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
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();
  await expect(page.locator("p", { hasText: /^Rp400\.000$/ }).first()).toBeVisible();

  const [{ accounts, personal }] = await admin<{ accounts: string; personal: string }[]>`
    select (select count(*) from fintrack.account)::text as accounts,
           ((select sum(physical_balance_minor) from fintrack.opening_account_position)
            - (select sum(amount_minor) from fintrack.opening_external_position))::text as personal`;
  expect({ accounts, personal }).toEqual({ accounts: "3", personal: "40000000" });

  await test.step("record a special expense on the cutover day", async () => {
    await page.getByRole("button", { name: "Catat" }).click();
    await page.getByRole("link", { name: /Pengeluaran khusus/ }).click();
    await expect(page.getByRole("heading", { name: "Pengeluaran khusus" })).toBeVisible();
    await page.getByLabel("Nominal").fill("25.000");
    await page.getByLabel("Kategori").selectOption({ label: "Lainnya…" });
    await page.getByLabel("Nama kategori baru").fill("Vape");
    await page.getByLabel("Dibayar dari").selectOption({ label: "BCA" });
    await page.getByRole("button", { name: "Simpan pengeluaran" }).click();
    // Same business date as the cutover: FinTrack asks before recording (PRD v0.18).
    await expect(page.getByText("Sudah termasuk saldo awal?")).toBeVisible();
    await page.getByRole("button", { name: "Belum, catat sekarang" }).click();
    await expect(page.getByText("Tersimpan", { exact: true })).toBeVisible();
  });

  await test.step("the expense shows in Aktivitas and the balances", async () => {
    await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Aktivitas" }).click();
    await expect(page.getByRole("heading", { name: "Aktivitas" })).toBeVisible();
    await expect(page.getByText("Vape", { exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Beranda" }).click();
    await expect(page.locator("p", { hasText: /^Rp375\.000$/ }).first()).toBeVisible();
  });

  await test.step("every destination renders", async () => {
    const nav = page.getByRole("navigation", { name: "Navigasi utama" });
    await nav.getByRole("link", { name: "Rutinitas" }).click();
    await expect(page.getByRole("heading", { name: "Rutinitas" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Settlement DANA" })).toBeVisible();
    await nav.getByRole("link", { name: "Akun" }).click();
    await expect(page.getByRole("heading", { name: "Akun", exact: true })).toBeVisible();
    await expect(page.getByText("Dosen", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Pengaturan" }).click();
    await expect(page.getByRole("heading", { name: "Pengaturan" })).toBeVisible();
    await expect(page.getByText("Langganan", { exact: true })).toBeVisible();
  });

  await test.step("Koreksi replaces the amount and keeps the original", async () => {
    await page.goto("/aktivitas");
    await page.getByRole("link", { name: /Vape/ }).click();
    await expect(page.getByRole("heading", { name: "Koreksi" })).toBeVisible();
    await page.getByLabel("Nominal yang benar").fill("30.000");
    await page.getByRole("button", { name: "Simpan koreksi" }).click();
    await expect(page.getByRole("heading", { name: "Pengganti · Vape" })).toBeVisible();
    await page.goto("/");
    await expect(page.locator("p", { hasText: /^Rp370\.000$/ }).first()).toBeVisible();
  });

  await test.step("secondary pages render", async () => {
    const pages: [string, string][] = [
      ["/rutinitas/settlement", "Settlement DANA"],
      ["/catat/transfer", "Transfer"],
      ["/catat/saldo", "Update saldo"],
      ["/catat/dana-titipan", "Dana titipan"],
      ["/akun/saldo-awal", "Saldo awal"],
    ];
    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
    await page.goto("/akun");
    await page.getByRole("link", { name: /^BCA/ }).click();
    await expect(page.getByRole("heading", { name: "Rekonsiliasi" })).toBeVisible();
    await page.getByRole("link", { name: /Dosen/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Dosen" })).toBeVisible();
  });

  await test.step("installable but online-only", async () => {
    const manifest = await (await page.request.get("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({ display: "standalone", start_url: "/" });
    expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons as { src: string }[]) expect((await page.request.get(icon.src)).status()).toBe(200);
    expect(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations())?.length ?? 0)).toBe(0);
  });

  await test.step("Pengaturan installs through the browser prompt", async () => {
    type Probe = Window & { installPrompted?: boolean };
    await page.goto("/pengaturan");
    const install = page.locator("section", { has: page.getByRole("heading", { name: "Pasang aplikasi" }) });
    // Hydrated, and no browser prompt yet: the menu steps show instead of a button.
    await expect(install.getByText(/menu browser/)).toBeVisible();
    await expect(install.getByRole("button", { name: "Pasang FinTrack" })).toHaveCount(0);

    // A stand-in for Chromium's event; `false` means FinTrack kept it (no mini-infobar).
    const notCancelled = await page.evaluate(() =>
      window.dispatchEvent(
        Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
          prompt: async () => {
            (window as Probe).installPrompted = true;
          },
          userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
        }),
      ),
    );
    expect(notCancelled).toBe(false);
    await install.getByRole("button", { name: "Pasang FinTrack" }).click();
    await expect(install.getByText(/^FinTrack terpasang\./)).toBeVisible();
    expect(await page.evaluate(() => (window as Probe).installPrompted)).toBe(true);
  });
});
