import { defineConfig } from "drizzle-kit";

// Migrations are generated from the TypeScript schema and applied only by the
// trusted migration runner (scripts/migrate.mts). `drizzle-kit push` is never used.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema",
  out: "./drizzle",
  schemaFilter: ["fintrack", "ops"],
  dbCredentials: {
    url: process.env.ADMIN_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  },
  strict: true,
  verbose: true,
});
