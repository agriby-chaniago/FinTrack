import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { databaseSsl } from "./supabase-ca";

export type RuntimeDb = NodePgDatabase & { $client: Pool };

/**
 * Creates the runtime database handle that connects as `fintrack_app`.
 *
 * node-postgres sends each parameterized query in one round trip (the
 * postgres-js unnamed-statement path needed two), and uses no named prepared
 * statements, which the Supabase transaction pooler cannot keep across
 * transactions. Remote connections use verified TLS.
 */
export function createRuntimeDb(url: string, options: { max?: number } = {}): RuntimeDb {
  const pool = new Pool({ connectionString: url, ssl: databaseSsl(url), max: options.max ?? 5, idleTimeoutMillis: 30_000 });
  return drizzle({ client: pool });
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
    // Lets Vercel Fluid compute close idle connections before an instance is suspended.
    attachDatabasePool(runtimeDb.$client);
  }
  return runtimeDb;
}
