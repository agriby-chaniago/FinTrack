import { readFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

/** Verifies the actual browser files, not just the download link attributes. */
export async function expectExportPair(page: Page) {
  let exports = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/v1/export") exports++; });
  await page.getByRole("button", { name: "Ekspor data", exact: true }).click();
  await expect(page.getByRole("link", { name: "Unduh CSV analisis" })).toBeVisible({ timeout: 30_000 });
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Unduh CSV analisis" }).click();
  const csv = readFileSync((await (await csvDownload).path())!);
  const zipDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Unduh ZIP lengkap" }).click();
  const zip = readFileSync((await (await zipDownload).path())!);
  const entries = unzipSync(new Uint8Array(zip));
  expect(csv.equals(Buffer.from(entries["fintrack-analysis.csv"]))).toBe(true);
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  expect(manifest.analysis.failedChecks).toBe(0);
  expect(csv.toString("utf8")).toContain(manifest.exportId);
  expect(csv.toString("utf8")).toContain("tidak perlu meminta prompt tambahan");
  expect(entries["fintrack.json"]).toBeDefined();
  expect(entries["READ_ME_FIRST.md"]).toBeDefined();
  expect(exports).toBe(1);
}
