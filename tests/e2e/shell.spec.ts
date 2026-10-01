// Shell and Rutinitas polish after owner review of S15: the FinTrack mark before
// the name, an optically centered `+ Catat`, and evenly split occurrence actions.
import { readFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

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
  user = await createAuthUser(clients.authAdmin, "e2e-shell");
  // Cutover three days ago leaves this month's income and obligations pending.
  await resetWithConfirmedFixture(clients, user.id, `${daysAgo(3)}T20:00:00+07:00`);
});

test.afterAll(async () => {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await clients.authAdmin.auth.admin.deleteUser(user.id);
  await closeClients(clients);
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Personal cash tercatat")).toBeVisible();
}

/** Horizontal distance between the drawn content (icon ink to text end) and the button's center. */
function inkOffset(button: Locator) {
  return button.evaluate((el) => {
    const ink = el.querySelector("svg path")!.getBoundingClientRect();
    const text = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const box = el.getBoundingClientRect();
    return (ink.left + range.getBoundingClientRect().right) / 2 - (box.left + box.right) / 2;
  });
}

test("the FinTrack mark sits before the name", async ({ page }) => {
  await signIn(page);
  const brand = page.locator("header").getByText("FinTrack", { exact: true });
  await expect(brand.locator("svg")).toBeVisible();
});

test("+ Catat is optically centered on mobile and desktop", async ({ page }) => {
  await signIn(page);
  expect(Math.abs(await inkOffset(page.getByRole("button", { name: "Catat" })))).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(Math.abs(await inkOffset(page.locator("aside").getByRole("button", { name: "Catat" })))).toBeLessThanOrEqual(1);
});

test("occurrence actions split the card width evenly", async ({ page }) => {
  await signIn(page);
  await page.goto("/rutinitas");
  const primary = (await page.getByRole("button", { name: /^Konfirmasi sesuai saran/ }).first().boundingBox())!;
  const edit = (await page.getByRole("button", { name: "Ubah detail" }).first().boundingBox())!;
  const noEvent = (await page.getByRole("button", { name: "Tidak diterima" }).boundingBox())!;
  expect(Math.abs(edit.width - noEvent.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(edit.x - primary.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(noEvent.x + noEvent.width - (primary.x + primary.width))).toBeLessThanOrEqual(1);
});
