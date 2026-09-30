import { fileURLToPath } from "node:url";

import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Loads .env and .env.local (local Supabase). FINTRACK_ENV=staging also loads
    // .env.staging.local, which takes precedence, to run the suites against staging.
    env: loadEnv(process.env.FINTRACK_ENV ?? "", process.cwd(), ""),
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["{src,tests}/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts", "node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["tests/**/*.integration.test.ts"],
          // Hosted staging adds network latency on every query.
          testTimeout: 240_000,
          hookTimeout: 240_000,
          // Integration tests share one local database.
          fileParallelism: false,
        },
      },
    ],
  },
});
