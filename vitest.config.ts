import { fileURLToPath } from "node:url";

import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Loads .env and .env.local (copied from .env.example for local Supabase).
    env: loadEnv("", process.cwd(), ""),
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
          // Integration tests share one local database.
          fileParallelism: false,
        },
      },
    ],
  },
});
