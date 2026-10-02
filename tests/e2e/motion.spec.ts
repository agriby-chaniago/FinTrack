// Motion surfaces (PRD v0.20 P3): the + Catat sheet, reduced motion, collapses,
// toasts, native disclosures, and the content fade after a skeleton.
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

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
  user = await createAuthUser(clients.authAdmin, "e2e-motion");
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

const identity = /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/;

/** Clicks the visible + Catat button and records the sheet panel's transform every frame for 400 ms. */
function openSheetAndSample(page: Page) {
  return page.evaluate(async () => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Catat" && b.checkVisibility())!;
    button.click();
    const seen: string[] = [];
    const start = performance.now();
    while (performance.now() - start < 400) {
      await new Promise(requestAnimationFrame);
      const panel = document.querySelector("dialog[open] > div");
      if (panel) seen.push(getComputedStyle(panel).transform);
    }
    return seen;
  });
}

test("the + Catat sheet slides in", async ({ page }) => {
  await signIn(page);
  const transforms = await openSheetAndSample(page);
  expect(transforms.some((t) => !identity.test(t))).toBe(true);
  expect(transforms.at(-1)).toMatch(identity);
});

test("Escape closes the sheet and returns focus", async ({ page }) => {
  await signIn(page);
  const button = page.getByRole("button", { name: "Catat" });
  await button.click();
  await expect(page.getByRole("dialog", { name: "Catat" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("reduced motion keeps the sheet still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  const transforms = await openSheetAndSample(page);
  expect(transforms.length).toBeGreaterThan(0);
  expect(transforms.every((t) => identity.test(t))).toBe(true);
});

test("Ubah detail reveals the actual fields and Tutup detail removes them", async ({ page }) => {
  await signIn(page);
  await page.goto("/rutinitas");
  await page.getByRole("button", { name: "Ubah detail" }).first().click();
  await expect(page.getByLabel("Tanggal aktual")).toBeVisible();
  const heights = await page.getByLabel("Tanggal aktual").evaluate(async (input) => {
    const region = input.closest("[style]") as HTMLElement;
    const seen: number[] = [];
    (document.querySelector("button[aria-expanded='true']") as HTMLButtonElement | null)?.click();
    const start = performance.now();
    while (performance.now() - start < 300) {
      await new Promise(requestAnimationFrame);
      seen.push(region.getBoundingClientRect().height);
    }
    return seen;
  });
  expect(new Set(heights.map(Math.round)).size).toBeGreaterThan(2);
  await expect(page.getByLabel("Tanggal aktual")).toHaveCount(0);
});

test("native disclosures open and close smoothly", async ({ page }) => {
  await signIn(page);
  await page.goto("/rutinitas");
  const duration = await page.locator("details").first().evaluate((el) => getComputedStyle(el, "::details-content").transitionDuration);
  expect(duration).toContain("0.18s");
});

test("confirming an occurrence shows a toast and the confirmed state", async ({ page }) => {
  await signIn(page);
  await page.goto("/rutinitas");
  await page.getByRole("button", { name: /^Konfirmasi sesuai saran · Rp750\.000/ }).click();
  const toast = page.getByRole("status").filter({ hasText: "Income bulanan dikonfirmasi" });
  await expect(toast).toBeVisible();
  expect(await toast.locator(".toast-timer").evaluate((el) => `${getComputedStyle(el).animationName} ${getComputedStyle(el).animationDuration}`)).toBe("drain 3.5s");
  expect(await toast.locator("svg path").evaluate((el) => getComputedStyle(el).animationName)).toBe("draw");
  await expect(page.getByRole("button", { name: "Tandai tidak diterima" })).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 6000 });
});

test("page content fades in when it replaces the skeleton", async ({ page }) => {
  await signIn(page);
  await page.goto("/akun");
  // Wait for the page itself: the skeleton it replaces is detached and reads as "".
  await expect(page.getByRole("heading", { level: 1, name: "Akun" })).toBeVisible();
  await expect.poll(() => page.locator("main > *").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("fade-in");
});

// Expressive-calm motion (PRD v0.21 P9).

test("page sections rise in one after another", async ({ page }) => {
  await signIn(page);
  const sections = page.locator("main .stagger > *");
  await expect.poll(() => sections.nth(1).evaluate((el) => getComputedStyle(el).animationName)).toBe("rise");
  const delays = await sections.evaluateAll((els) => els.slice(0, 3).map((el) => getComputedStyle(el).animationDelay));
  // Meriah (PRD v0.22 P10): sections 90 ms apart.
  expect(delays).toEqual(["0s", "0.09s", "0.18s"]);
});

test("reduced motion drops every animation delay", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  const delays = await page.locator("main .stagger > *").evaluateAll((els) => els.map((el) => getComputedStyle(el).animationDelay));
  expect(delays.length).toBeGreaterThan(2);
  expect(new Set(delays)).toEqual(new Set(["0s"]));
});

type Recorder = { __headline: string[] };

/** Starts recording every text the headline amount shows while visible (runs in the page). */
function startHeadlineRecorder() {
  const seen: string[] = ((window as unknown as Recorder).__headline = []);
  new MutationObserver(() => {
    // Only what a person can see: a streamed boundary stays hidden until React reveals it.
    const el = document.querySelector("[data-count-up]");
    const text = el && el.getClientRects().length > 0 ? el.textContent : null;
    if (text && text !== seen.at(-1)) seen.push(text);
  }).observe(document, { subtree: true, childList: true, characterData: true });
}

const recorded = (page: Page) => page.evaluate(() => (window as unknown as Recorder).__headline);
const digits = (text: string) => BigInt(text.replace(/\D/g, "") || "0");

/** The digits of the exact headline, from the amount in sen (whole rupiah drop ",00"). */
async function exactDigits(page: Page) {
  const minor = BigInt((await page.locator("[data-count-up]").getAttribute("data-count-up"))!);
  const absolute = minor < 0n ? -minor : minor;
  return `${absolute / 100n}${absolute % 100n === 0n ? "" : (absolute % 100n).toString().padStart(2, "0")}`;
}

/** The headline went Rp0 → … → exact without going down; `noFlash` also requires Rp0 to be the first text ever shown. */
async function expectCountedUp(page: Page, noFlash = false) {
  const exact = await exactDigits(page);
  await expect.poll(async () => (await recorded(page)).at(-1)?.replace(/\D/g, "")).toBe(exact);
  const texts = await recorded(page);
  const from = texts.indexOf("Rp0");
  expect(from).toBe(noFlash ? 0 : from);
  expect(from).toBeGreaterThanOrEqual(0);
  const values = texts.slice(from).map(digits);
  expect(values.every((value, i) => i === 0 || value >= values[i - 1])).toBe(true);
  expect(values.length).toBeGreaterThan(2);
}

test("the headline counts up on a full page load", async ({ page }) => {
  await signIn(page);
  await page.addInitScript(startHeadlineRecorder);
  await page.goto("/");
  await expectCountedUp(page, true);
});

test("the headline counts up again after a client navigation", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Navigasi utama" });
  await nav.getByRole("link", { name: "Rutinitas" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Rutinitas" })).toBeVisible();
  await page.evaluate(startHeadlineRecorder);
  await nav.getByRole("link", { name: "Beranda" }).click();
  await expectCountedUp(page);
});

test("reduced motion shows the exact headline at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await page.addInitScript(startHeadlineRecorder);
  await page.goto("/");
  await expect(page.locator("[data-count-up]")).toHaveAttribute("data-counted", "");
  expect(await recorded(page)).not.toContain("Rp0");
  expect((await page.locator("[data-count-up]").textContent())!.replace(/\D/g, "")).toBe(await exactDigits(page));
});

test("progress fills and the week strip pops in order", async ({ page }) => {
  await signIn(page);
  const bar = page.getByRole("progressbar", { name: "Kelayakan tren mingguan" }).locator("div");
  expect(await bar.evaluate((el) => getComputedStyle(el).animationName)).toBe("fill");
  const markers = page.getByRole("list", { name: "Income harian minggu berjalan" }).locator("li > span:first-child");
  const timing = await markers.evaluateAll((els) => els.slice(0, 3).map((el) => [getComputedStyle(el).animationName, parseFloat(getComputedStyle(el).animationDelay)] as const));
  expect(timing.map(([name]) => name)).toEqual(["pop", "pop", "pop"]);
  // Markers pop 40 ms apart, counted from their section's delay.
  expect(timing.slice(1).map(([, delay], i) => Math.round((delay - timing[i][1]) * 1000))).toEqual([40, 40]);
});

test("+ Catat turns into a close mark while the sheet is open", async ({ page }) => {
  await signIn(page);
  const state = await page.evaluate(async () => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Catat" && b.checkVisibility())!;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    return `${button.getAttribute("aria-expanded")} ${getComputedStyle(button.querySelector("svg")!).rotate}`;
  });
  expect(state).toBe("true 45deg");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Catat" })).toHaveAttribute("aria-expanded", "false");
});

test("account cards give a little when pressed", async ({ page }) => {
  await signIn(page);
  const card = page.locator("main a[href^='/akun/']").first();
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.mouse.down();
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el).scale)).toBe("0.98");
  await page.mouse.up();
});

test("screen readers get the exact headline, never a counting value", async ({ page }) => {
  await signIn(page);
  const counting = page.locator("[data-count-up]");
  await expect(counting).toHaveAttribute("aria-hidden", "true");
  const spoken = page.locator("p:has(> [data-count-up]) > .sr-only");
  expect((await spoken.textContent())!.replace(/\D/g, "")).toBe(await exactDigits(page));
});

// Meriah motion (PRD v0.22 P10).

test("cards and rows arrive one by one after their section", async ({ page }) => {
  await signIn(page);
  // Beranda: the task list, then the account cards.
  const cards = page.locator("main .cascade").nth(1).locator("> *");
  const timing = await cards.evaluateAll((els) => els.map((el) => [getComputedStyle(el).animationName, parseFloat(getComputedStyle(el).animationDelay)] as const));
  expect(timing.length).toBeGreaterThan(1);
  expect(timing.every(([name]) => name === "rise-small")).toBe(true);
  expect(Math.round((timing[1][1] - timing[0][1]) * 1000)).toBe(90);
});

test("today pulses once, progress shines, and the headline line sweeps", async ({ page }) => {
  await signIn(page);
  const today = page.getByRole("list", { name: "Income harian minggu berjalan" }).locator("li[aria-label$='hari ini'] > span:first-child");
  expect(await today.evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("ping");
  const bar = page.getByRole("progressbar", { name: "Kelayakan tren mingguan" }).locator("div");
  expect(await bar.evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("shine-pass");
  expect(await page.locator("[data-count-up]").evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("sweep-line");
});

type VtWindow = { __vt: string[] };

/** Records view-transition animation names with their durations for 1.5 s after this call. */
function recordViewTransitions(page: Page) {
  return page.evaluate(() => {
    const seen: string[] = ((window as unknown as VtWindow).__vt = []);
    const start = performance.now();
    const tick = () => {
      for (const animation of document.getAnimations()) {
        const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement ?? "";
        if (!pseudo.startsWith("::view-transition")) continue;
        const entry = `${(animation as CSSAnimation).animationName}:${animation.effect?.getComputedTiming().duration}`;
        if (!seen.includes(entry)) seen.push(entry);
      }
      if (performance.now() - start < 1500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const viewTransitions = (page: Page) => page.evaluate(() => (window as unknown as VtWindow).__vt.join(" "));

test("switching tabs slides the page in tab order", async ({ page }) => {
  await signIn(page);
  await page.waitForLoadState("networkidle");
  await recordViewTransitions(page);
  await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Rutinitas" }).click();
  await expect.poll(() => viewTransitions(page)).toMatch(/tab-enter:520/);
  expect(await viewTransitions(page)).toMatch(/tab-leave:160/);
});

test("reduced motion does not slide between tabs", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await page.waitForLoadState("networkidle");
  await recordViewTransitions(page);
  await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Rutinitas" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Rutinitas" })).toBeVisible();
  await page.waitForTimeout(600);
  expect((await viewTransitions(page)).split(" ").filter((entry) => entry && !entry.endsWith(":0"))).toEqual([]);
});

test("the tab indicator slides to the new tab and its icon hops", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Navigasi utama" });
  await nav.getByRole("link", { name: "Rutinitas" }).click();
  const link = nav.getByRole("link", { name: "Rutinitas" });
  await expect(link).toHaveAttribute("aria-current", "page");
  expect(await link.locator("svg").evaluate((el) => getComputedStyle(el).animationName)).toBe("hop");
  const indicator = nav.locator(".tab-indicator");
  expect(await indicator.evaluate((el) => getComputedStyle(el).transitionDuration)).toContain("0.42s");
  await expect.poll(async () => Math.round((await indicator.boundingBox())!.x - (await link.boundingBox())!.x)).toBe(0);
});

/** Presses the first "Ubah detail" button and returns its ripple locator while the pointer is down. */
async function pressUbahDetail(page: Page) {
  await page.goto("/rutinitas");
  // The ripple listener is installed once the app shell has hydrated.
  await page.waitForLoadState("networkidle");
  const button = page.getByRole("button", { name: "Ubah detail" }).first();
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.mouse.down();
  return button.locator(".ripple-wave");
}

test("pressing a button spreads a square ripple", async ({ page }) => {
  await signIn(page);
  const wave = await pressUbahDetail(page);
  await expect(wave).toHaveCount(1);
  expect(await wave.evaluate((el) => getComputedStyle(el).animationName)).toBe("ripple");
  await page.mouse.up();
  await expect(wave).toHaveCount(0);
});

test("reduced motion adds no ripple", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  const wave = await pressUbahDetail(page);
  await page.waitForTimeout(100);
  await expect(wave).toHaveCount(0);
  await page.mouse.up();
});

test("+ Catat choices arrive one by one and their icons pop", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Catat" }).click();
  const items = page.getByRole("dialog", { name: "Catat" }).locator("ul > li");
  const timing = await items.evaluateAll((els) => els.map((el) => [getComputedStyle(el).animationName, parseFloat(getComputedStyle(el).animationDelay)] as const));
  expect(timing.every(([name]) => name === "rise-sheet")).toBe(true);
  expect(Math.round((timing[1][1] - timing[0][1]) * 1000)).toBe(55);
  expect(await items.first().locator(".sheet-icon").evaluate((el) => getComputedStyle(el).animationName)).toBe("pop-icon");
});

// S21: the toast stays out of the way.
test("the toast sits under the header on a phone and dismisses on tap", async ({ page }) => {
  await signIn(page);
  await page.goto("/rutinitas");
  await page.getByRole("button", { name: /^Konfirmasi sesuai saran · Rp/ }).first().click();
  const toast = page.getByRole("status").filter({ hasText: "dikonfirmasi" });
  await expect(toast).toBeVisible();
  const box = (await toast.boundingBox())!;
  expect(box.y).toBeLessThan(page.viewportSize()!.height * 0.3);
  await toast.getByRole("button").click();
  await expect(toast).toBeHidden({ timeout: 1000 });
});
