// Writes .env.local from .env.example plus the keys printed by `supabase status`.
// Supabase API keys are therefore never committed, even the local defaults.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" })) as Record<
  string,
  string
>;

const replacements: Record<string, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: status.SECRET_KEY,
};

const lines = readFileSync(".env.example", "utf8")
  .split("\n")
  .map((line) => {
    const name = line.split("=", 1)[0];
    const value = replacements[name];
    return value ? `${name}=${value}` : line;
  });

writeFileSync(".env.local", lines.join("\n"));
console.log("Wrote .env.local from .env.example and supabase status");
