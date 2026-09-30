import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export type RuntimeDb = PostgresJsDatabase & { $client: postgres.Sql };

/**
 * Creates the runtime database handle that connects as `fintrack_app`.
 *
 * `prepare: false` is required because the Supabase transaction pooler does not
 * keep prepared statements across transactions.
 */
export function createRuntimeDb(url: string, options: { max?: number } = {}): RuntimeDb {
  const client = postgres(url, { prepare: false, max: options.max ?? 5, onnotice: () => {} });
  return drizzle(client);
}

let runtimeDb: RuntimeDb | undefined;

/** Process-wide runtime handle. Feature modules must go through withOwnerDb(). */
export function getRuntimeDb(): RuntimeDb {
  if (!runtimeDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not configured");
    }
    runtimeDb = createRuntimeDb(url);
  }
  return runtimeDb;
}
