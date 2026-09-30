// Fails a database test file when code overlaps queries on one pg client (for
// example Promise.all inside one owner transaction). pg 8 queues them with a
// one-time deprecation warning, pg 9 will throw, and the Supabase transaction
// pooler runs them one at a time anyway. See AGENTS.md (Performance and
// data-access rules).
import pg from "pg";
import { afterAll, expect } from "vitest";

type ClientState = { _activeQuery?: unknown; _queryQueue?: unknown[] };

const overlapping: string[] = [];
const original = pg.Client.prototype.query;
pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
  const state = this as unknown as ClientState;
  if (state._activeQuery || (state._queryQueue?.length ?? 0) > 0) {
    overlapping.push(new Error("query issued while this client was still busy").stack ?? "overlap");
  }
  return (original as (...values: unknown[]) => unknown).apply(this, args);
} as typeof pg.Client.prototype.query;

afterAll(() => {
  expect(overlapping, "overlapping queries on one pg client").toEqual([]);
});
