import { afterEach, describe, expect, it, vi } from "vitest";

import { appOrigin } from "./app-origin";

describe("appOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers APP_ORIGIN", () => {
    vi.stubEnv("APP_ORIGIN", "https://fintrack.example");
    vi.stubEnv("VERCEL_BRANCH_URL", "branch.vercel.app");
    expect(appOrigin()).toBe("https://fintrack.example");
  });

  it("falls back to the Vercel branch URL on previews", () => {
    vi.stubEnv("APP_ORIGIN", "");
    vi.stubEnv("VERCEL_BRANCH_URL", "fintrack-git-main-team.vercel.app");
    expect(appOrigin()).toBe("https://fintrack-git-main-team.vercel.app");
  });

  it("fails closed without any origin", () => {
    vi.stubEnv("APP_ORIGIN", "");
    vi.stubEnv("VERCEL_BRANCH_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    expect(() => appOrigin()).toThrow("APP_ORIGIN");
  });
});
