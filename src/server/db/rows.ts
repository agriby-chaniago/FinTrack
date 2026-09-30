import type { SQL } from "drizzle-orm";

/** Anything that can run raw SQL: the runtime database or an owner transaction. */
type Executor = { execute: (query: SQL) => Promise<unknown> };

/**
 * Runs raw SQL and returns its rows. Every raw query goes through here so the
 * driver's result shape (node-postgres returns `{ rows }`) is handled in one
 * place. Timestamps come back as strings; cast or format them in SQL.
 */
export async function sqlRows<T>(db: Executor, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as { rows?: T[] } | T[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}
