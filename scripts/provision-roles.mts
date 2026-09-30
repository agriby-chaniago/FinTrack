// Enables LOGIN for the platform roles and sets their passwords from the
// environment. Run once per environment after migrations, and again to rotate.
import postgres from "postgres";
import { databaseSsl } from "../src/server/db/supabase-ca.ts";

const url = process.env.ADMIN_DATABASE_URL;
if (!url) {
  console.error("ADMIN_DATABASE_URL is required");
  process.exit(1);
}

const roles = [
  { role: "fintrack_app", passwordEnv: "FINTRACK_APP_DB_PASSWORD" },
  { role: "fintrack_probe", passwordEnv: "FINTRACK_PROBE_DB_PASSWORD" },
  { role: "fintrack_backup", passwordEnv: "FINTRACK_BACKUP_DB_PASSWORD" },
] as const;

const sql = postgres(url, { ssl: databaseSsl(url), max: 1, onnotice: () => {} });

try {
  for (const { role, passwordEnv } of roles) {
    const password = process.env[passwordEnv];
    if (!password) {
      console.log(`Skipping ${role}: ${passwordEnv} is not set`);
      continue;
    }
    if (password.length < 24) {
      throw new Error(`${passwordEnv} must be at least 24 characters`);
    }
    await sql.unsafe(`ALTER ROLE ${role} LOGIN PASSWORD ${quoteLiteral(password)}`);
    console.log(`Provisioned ${role}`);
  }
} finally {
  await sql.end();
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
