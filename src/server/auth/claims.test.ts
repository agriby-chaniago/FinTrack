import { describe, expect, it, vi } from "vitest";

import { resolveVerifiedClaims, type CredentialSources } from "./claims";

const owner = "7d1f1c1e-3c2a-4b7a-9d55-0f3f8b0e6a11";
const stranger = "0b6d7c55-1f0e-4a5b-8f0e-2a9d4c3b1e22";

function sources(overrides: Partial<CredentialSources> = {}): CredentialSources {
  return {
    authorizationHeader: null,
    hasCookieSession: false,
    verifyToken: async () => null,
    verifyCookieSession: async () => null,
    ...overrides,
  };
}

describe("resolveVerifiedClaims", () => {
  it("accepts a valid Bearer token", async () => {
    const claims = await resolveVerifiedClaims(
      sources({ authorizationHeader: "Bearer token-a", verifyToken: async () => ({ sub: owner, role: "authenticated" }) }),
    );
    expect(claims).toMatchObject({ sub: owner });
  });

  it("accepts a valid cookie session", async () => {
    const claims = await resolveVerifiedClaims(
      sources({ hasCookieSession: true, verifyCookieSession: async () => ({ sub: owner }) }),
    );
    expect(claims.sub).toBe(owner);
  });

  it("accepts cookie and Bearer credentials for the same identity", async () => {
    const claims = await resolveVerifiedClaims(
      sources({
        authorizationHeader: "Bearer token-a",
        hasCookieSession: true,
        verifyToken: async () => ({ sub: owner }),
        verifyCookieSession: async () => ({ sub: owner }),
      }),
    );
    expect(claims.sub).toBe(owner);
  });

  it("rejects cookie and Bearer credentials for different identities as ambiguous", async () => {
    await expect(
      resolveVerifiedClaims(
        sources({
          authorizationHeader: "Bearer token-a",
          hasCookieSession: true,
          verifyToken: async () => ({ sub: owner }),
          verifyCookieSession: async () => ({ sub: stranger }),
        }),
      ),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_IDENTITY", status: 401 });
  });

  it("rejects an invalid Bearer token even when a valid cookie session exists", async () => {
    await expect(
      resolveVerifiedClaims(
        sources({
          authorizationHeader: "Bearer forged",
          hasCookieSession: true,
          verifyToken: async () => null,
          verifyCookieSession: async () => ({ sub: owner }),
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_IDENTITY" });
  });

  it.each(["Basic abc", "Bearer", "Bearer a b", ""])("rejects a malformed Authorization header (%j)", async (header) => {
    const verifyToken = vi.fn(async () => ({ sub: owner }));
    await expect(resolveVerifiedClaims(sources({ authorizationHeader: header, verifyToken }))).rejects.toMatchObject({
      code: "INVALID_IDENTITY",
    });
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it("rejects requests without credentials, with an invalid cookie, or without a subject", async () => {
    await expect(resolveVerifiedClaims(sources())).rejects.toMatchObject({ code: "INVALID_IDENTITY" });
    await expect(resolveVerifiedClaims(sources({ hasCookieSession: true }))).rejects.toMatchObject({
      code: "INVALID_IDENTITY",
    });
    await expect(
      resolveVerifiedClaims(sources({ authorizationHeader: "Bearer t", verifyToken: async () => ({ role: "x" }) })),
    ).rejects.toMatchObject({ code: "INVALID_IDENTITY" });
  });
});
