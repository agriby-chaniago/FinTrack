// Opt-in: FINTRACK_STRESS=1 pnpm vitest run --project db tests/stress/export-load.integration.test.ts
// Never point the fixture helper or load generator at staging/production.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { strFromU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { analysisColumns } from "@/lib/export-contract";
import { analysisFromArchive } from "@/lib/export-download";
import { exportFiles, readExportSnapshot, zipStream } from "@/server/application/export";
import { readExportAnalysis } from "@/server/application/export-analysis";
import { createRuntimeDb, type RuntimeDb } from "@/server/db/client";
import { withOwnerDb } from "@/server/db/owner";

import { closeClients, createAuthUser, testClients, type TestClients, type TestUser } from "../helpers/owner";
import { seedExportStress } from "../helpers/export-stress";

const enabled = process.env.FINTRACK_STRESS === "1";
const diagnostic = process.env.FINTRACK_STRESS_DIAGNOSTIC === "1";
const base = "http://127.0.0.1:3200";
const reportPath = diagnostic ? "/tmp/fintrack-export-stage-diagnostic.json" : "docs/audit/2026-10-31-export-stress.json";
let clients: TestClients;
let user: TestUser;
let outsider: TestUser;
let db: RuntimeDb;
let server: ChildProcess;
let temp = "";
let queries = 0;
let peakRssMb = 0;
let completed = false;
let memoryTimer: ReturnType<typeof setInterval> | undefined;
const sourceFiles = ["src/server/application/export.ts", "src/server/application/export-analysis.ts", "src/server/application/settlement.ts", "src/lib/export-contract.ts", "src/lib/export-download.ts"];
const results: Record<string, unknown>[] = [];
const gates: string[] = [];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sampleMemory() {
  if (!server?.pid) return;
  const status = await readFile(`/proc/${server.pid}/status`, "utf8").catch(() => "");
  const value = Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1] ?? 0) / 1024;
  peakRssMb = Math.max(peakRssMb, value);
}

/** Independent RFC 4180 reader for assertions, including embedded newlines. */
function* csvRows(csv: string) {
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && char === ",") { row.push(cell); cell = ""; }
    else if (!quoted && (char === "\r" || char === "\n")) {
      if (char === "\r" && csv[i + 1] === "\n") i++;
      row.push(cell); yield row; row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); yield row; }
  if (quoted) throw new Error("Unclosed quoted CSV field");
}

async function validate(bytes: Uint8Array, fixture: Awaited<ReturnType<typeof seedExportStress>>) {
  const companion = await analysisFromArchive(bytes);
  const entries = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  expect(manifest.analysis.failedChecks).toBe(0);
  for (const file of manifest.files) expect(createHash("sha256").update(entries[file.path]).digest("hex")).toBe(file.sha256);
  const raw = JSON.parse(strFromU8(entries["fintrack.json"]));
  expect(raw.exportId).toBe(companion.exportId);
  const sourceIds = new Set(raw.datasets.ledger_entry.map((e: { id: string }) => e.id));
  expect(raw.datasets.ledger_leg.every((l: { entry_id: string }) => sourceIds.has(l.entry_id))).toBe(true);
  const ids = new Set<string>();
  let count = 0;
  let settlements = 0;
  let correction = false;
  const index = Object.fromEntries(analysisColumns.map((name, i) => [name, i]));
  for (const row of csvRows(strFromU8(companion.csv))) {
    if (count++ === 0) { expect(row).toEqual([...analysisColumns]); continue; }
    expect(row.length).toBe(analysisColumns.length);
    expect(row[index.export_id]).toBe(companion.exportId);
    const id = row[index.record_id];
    if (id) { expect(ids.has(id), `Duplicate record_id ${id}`).toBe(false); ids.add(id); }
    if (row[index.row_type] === "SETTLEMENT") { settlements++; expect(row[index.value]).toBe("350000"); }
    if (row[index.row_type] === "EVENT" && row[index.parent_id] === fixture.root && row[index.aggregation_role] === "DETAIL_FLOW") { correction = true; expect(row[index.outflow_effect_idr]).toBe(fixture.expectedCorrection); }
  }
  expect(settlements).toBe(fixture.weeks);
  expect(correction).toBe(true);
  return { bytes: bytes.byteLength, csvBytes: companion.csv.byteLength, analysisRows: count - 1 };
}

async function burst(concurrency: number, fixture: Awaited<ReturnType<typeof seedExportStress>>) {
  const began = performance.now();
  // Do not decompress in the timing phase: generator CPU must not masquerade
  // as HTTP latency. Each request owns its transaction; there is no SQL overlap.
  const responses = await Promise.all(Array.from({ length: concurrency }, async () => {
    const start = performance.now();
    const response = await fetch(`${base}/api/v1/export`, { headers: { authorization: `Bearer ${user.accessToken}` }, signal: AbortSignal.timeout(60_000) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { response, bytes, ms: performance.now() - start };
  }));
  await sampleMemory();
  const totalMs = performance.now() - began;
  const latencies = responses.map((r) => r.ms).sort((a, b) => a - b);
  for (const r of responses) {
    expect(r.response.status).toBe(200);
    expect(r.response.headers.get("cache-control")).toBe("no-store");
  }
  // Inspect every archive identity/hash; the detailed financial assertions are
  // executed for each response, not merely for one sample of a successful burst.
  let archive = { bytes: 0, csvBytes: 0, analysisRows: 0 };
  for (const r of responses) archive = await validate(r.bytes, fixture);
  const result = { kind: "burst", years: fixture.years, events: fixture.entries, settlements: fixture.settlements, revisions: fixture.revisions, closingRevisions: fixture.closingRevisions, concurrency, requests: concurrency, errors: 0, p50Ms: latencies[Math.ceil(concurrency * 0.5) - 1], p95Ms: latencies[Math.ceil(concurrency * 0.95) - 1], totalMs, ...archive, serverPeakRssMb: peakRssMb };
  results.push(result);
  console.log(JSON.stringify(result));
  if (result.p95Ms > (concurrency === 1 ? 15_000 : 60_000)) gates.push(`Latency gate failed: ${fixture.years} years/${concurrency} requests`);
}

async function queryCount(fixture: Awaited<ReturnType<typeof seedExportStress>>) {
  queries = 0;
  await withOwnerDb(db, { sub: user.id }, async (tx, principal) => {
    const start = performance.now();
    const snapshot = await readExportSnapshot(tx, principal.ownerId);
    const snapshotMs = performance.now() - start;
    const projectionStart = performance.now();
    const projection = await readExportAnalysis(tx, principal.ownerId, snapshot, new Date());
    const projectionMs = performance.now() - projectionStart;
    expect(projection.failedChecks).toBe(0);
    const filesStart = performance.now();
    const files = exportFiles(snapshot, new Date(), projection);
    const assemblyMs = performance.now() - filesStart;
    const zipStart = performance.now();
    const bytes = new Uint8Array(await new Response(zipStream(files)).arrayBuffer());
    const zipMs = performance.now() - zipStart;
    const stage = { kind: "stages", years: fixture.years, snapshotMs, projectionMs, assemblyMs, zipMs, zipBytes: bytes.length, uncompressedBytes: files.reduce((sum, file) => sum + file.content.length, 0) };
    results.push(stage);
    console.log(JSON.stringify(stage));
    if (fixture.years === 10) {
      const contents = Object.fromEntries(files.map((file) => [file.path, file.content]));
      for (const level of [1, 6] as const) {
        const began = performance.now();
        const archived = zipSync(contents, { level });
        const benchmark = { kind: "compression_benchmark", level, ms: performance.now() - began, bytes: archived.length };
        results.push(benchmark);
        console.log(JSON.stringify(benchmark));
      }
    }
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  results.push({ kind: "query_budget", years: fixture.years, closingRevisions: fixture.closingRevisions, queries, budget: 64 });
  if (queries > 64) gates.push(`Query budget ${queries}/64 with ${fixture.closingRevisions} closing revisions`);
}

async function postman(profile: "fixed" | "spike", peak: number) {
  const args = ["proxy", "postman", "performance", "run", "tests/stress/export.postman_collection.json", "--runner", "local", "--load-profile", profile, "--peak-vu", String(peak), "--duration", "1", "--data-file", join(temp, "iteration.json"), "--output", "ndjson", "--pass-if", "less_than(p95, 30000)", "--pass-if", "less_than_eq(error_rate, 0)"];
  if (profile === "spike") args.push("--base-vu", "1", "--load-segments", "10s,10s,10s");
  const child = spawn("rtk", args, { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk) => { output += String(chunk); });
  child.stderr?.on("data", (chunk) => { output += String(chunk); });
  const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  await sampleMemory();
  await writeFile(join(temp, `postman-${profile}.ndjson`), output, { mode: 0o600 });
  const events = output.split("\n").flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const summary = events.filter((e) => /summary|completed|error/i.test(String(e.type ?? e.event ?? ""))).at(-1);
  results.push({ kind: "postman", profile, peak, durationMinutes: 1, exitCode: code, summary: summary ?? output.slice(-1600).replaceAll(user.accessToken, "[fixture token redacted]"), serverPeakRssMb: peakRssMb });
  console.log(JSON.stringify({ kind: "postman", profile, peak, exitCode: code, summary: summary ?? output.slice(-1200).replaceAll(user.accessToken, "[redacted]") }));
  if (code !== 0) gates.push(`Postman ${profile} did not pass; inspect reported runner error or thresholds`);
}

describe.skipIf(!enabled)("bounded local export stress", () => {
  beforeAll(async () => {
    for (const key of ["DATABASE_URL", "ADMIN_DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
      if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(process.env[key]!).hostname)) throw new Error(`Stress fixtures require loopback ${key}`);
    }
    clients = testClients();
    user = await createAuthUser(clients.authAdmin, "stress-owner");
    outsider = await createAuthUser(clients.authAdmin, "stress-outsider");
    temp = await mkdtemp(join(tmpdir(), "fintrack-export-stress-"));
    await writeFile(join(temp, "iteration.json"), JSON.stringify([{ token: user.accessToken }]), { mode: 0o600 });
    db = createRuntimeDb(process.env.DATABASE_URL!, { max: 1 });
    db.$client.on("connect", (connection) => {
      const original = connection.query.bind(connection) as (...args: unknown[]) => unknown;
      (connection as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => { queries++; return original(...args); };
    });
    server = spawn(process.execPath, ["--max-old-space-size=1024", "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3200"], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "ignore", "pipe"] });
    let logs = "";
    server.stderr?.on("data", (chunk) => { logs += String(chunk); });
    memoryTimer = setInterval(() => { void sampleMemory(); }, 100);
    for (let i = 0; i < 80; i++) {
      if (await fetch(`${base}/login`).then((r) => r.ok).catch(() => false)) return;
      if (server.exitCode !== null) throw new Error(`Local server exited: ${logs.slice(-1500)}`);
      await pause(250);
    }
    throw new Error("Local server did not start");
  }, 60_000);

  afterAll(async () => {
    await sampleMemory();
    if (memoryTimer) clearInterval(memoryTimer);
    if (!completed) gates.push("Not all stress profiles completed; no readiness claim is supported");
    if (peakRssMb > 1536) gates.push(`Server peak RSS ${peakRssMb.toFixed(1)} MiB exceeds 1536 MiB gate`);
    const hashes: Record<string, string> = {};
    for (const path of sourceFiles) hashes[path] = createHash("sha256").update(await readFile(path)).digest("hex");
    await mkdir("docs/audit", { recursive: true });
    await writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), target: base, data: "synthetic, local Supabase only", scope: diagnostic ? "diagnostic only; not a full load verdict" : "full stress profiles", node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length, nodeHeapLimitMiB: 1024, serverPeakRssMb: peakRssMb, generatorPeakRssMb: process.resourceUsage().maxRSS / 1024, sourceHashes: hashes, results, gates, passed: !diagnostic && gates.length === 0, notEstablished: ["Hosted Vercel latency/capacity", "AI response without prompt"], tempLogDirectory: temp }, null, 2));
    server?.kill("SIGTERM");
    if (db) await db.$client.end();
    if (clients) {
      await clients.admin`truncate fintrack.app_owner cascade`;
      if (user) await clients.authAdmin.auth.admin.deleteUser(user.id);
      if (outsider) await clients.authAdmin.auth.admin.deleteUser(outsider.id);
      await closeClients(clients);
    }
    if (temp) await rm(join(temp, "iteration.json"), { force: true });
    expect(gates).toEqual([]);
  }, 60_000);

  it("checks history growth, correction chains, simultaneous exports, sustained load, and a spike", async () => {
    for (const profile of [{ years: 1, events: 1000, revisions: 24, closingRevisions: 0 }, { years: 5, events: 10000, revisions: 250, closingRevisions: 20 }, { years: 10, events: 25000, revisions: 500, closingRevisions: 100 }]) {
      if (diagnostic && profile.years !== 10) continue;
      const fixture = await seedExportStress(clients, user, profile, new Date());
      console.log(JSON.stringify({ kind: "fixture_ready", ...profile, entries: fixture.entries, settlements: fixture.settlements }));
      await queryCount(fixture);
      await burst(1, fixture);
      if (diagnostic) continue;
      await burst(5, fixture);
      if (profile.years === 5) await postman("fixed", 5);
      if (profile.years === 10) { await burst(10, fixture); await postman("spike", 10); }
      // A request rejected for lack of authorization must remain a JSON error,
      // even after load; neither token nor financial data should be returned.
      for (const [token, status] of [["", 401], [outsider.accessToken, 403]] as const) {
        const response = await fetch(`${base}/api/v1/export`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
        expect(response.status).toBe(status);
        expect(response.headers.get("content-type")).toContain("application/json");
      }
    }
    completed = true;
    expect(gates).toEqual([]);
  }, 420_000);
});
