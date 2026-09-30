// Trusted one-off owner bootstrap and privileged recovery.
//
//   pnpm owner:bind --auth-user-id <uuid>            first bootstrap (idempotent)
//   pnpm owner:bind --auth-user-id <uuid> --rebind   recovery after Auth user loss
//
// Invite the owner from the Supabase Dashboard first, then bind the invited user's UUID.
import { parseArgs } from "node:util";

import postgres from "postgres";

import { BindOwnerError, bindOwner } from "../src/server/bootstrap/bind-owner.ts";
import { databaseSsl } from "../src/server/db/supabase-ca.ts";

const { values } = parseArgs({
  // pnpm forwards a literal "--" separator; drop it so flags are still parsed.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    "auth-user-id": { type: "string" },
    rebind: { type: "boolean", default: false },
  },
});

const url = process.env.ADMIN_DATABASE_URL;
const authUserId = values["auth-user-id"];
if (!url || !authUserId) {
  console.error("ADMIN_DATABASE_URL and --auth-user-id are required");
  process.exit(1);
}

const sql = postgres(url, { ssl: databaseSsl(url), max: 1, onnotice: () => {} });
try {
  const result = await bindOwner(sql, authUserId, { rebind: values.rebind });
  console.log(`Owner binding: ${result}`);
} catch (error) {
  if (error instanceof BindOwnerError) {
    console.error(`Owner binding failed (${error.code}): ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await sql.end();
}
