// Trusted migration runner. Applies committed migrations in ./drizzle using the
// admin connection. It never runs during build, application startup, or a request.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseSsl } from "../src/server/db/supabase-ca.ts";

const url = process.env.ADMIN_DATABASE_URL;
if (!url) {
  console.error("ADMIN_DATABASE_URL is required");
  process.exit(1);
}

const client = postgres(url, { ssl: databaseSsl(url), max: 1, onnotice: () => {} });

try {
  // MIGRATIONS_FOLDER lets a restore drill stop at the migration level recorded in a backup.
  await migrate(drizzle(client), { migrationsFolder: process.env.MIGRATIONS_FOLDER ?? "./drizzle", migrationsSchema: "drizzle" });
  console.log("Migrations applied");
} finally {
  await client.end();
}
