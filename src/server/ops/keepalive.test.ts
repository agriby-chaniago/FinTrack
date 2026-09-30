import { describe, expect, it, vi } from "vitest";

import { handleKeepalive, type KeepaliveDeps } from "./keepalive";

const token = "test-keepalive-token-0123456789abcdef";

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return new Request("https://fintrack.example/api/internal/keepalive", { method: "POST", headers });
}

function deps(overrides: Partial<KeepaliveDeps> = {}): KeepaliveDeps {
  return { environment: "production", expectedToken: token, probe: async () => true, ...overrides };
}

describe("handleKeepalive", () => {
  it("returns 204 with no-store after a successful probe", async () => {
    const probe = vi.fn(async () => true);
    const response = await handleKeepalive(request(`Bearer ${token}`), deps({ probe }));

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(probe).toHaveBeenCalledOnce();
  });

  it.each(["preview", "development", undefined])("is unavailable outside production (%s)", async (environment) => {
    const probe = vi.fn(async () => true);
    const response = await handleKeepalive(request(`Bearer ${token}`), deps({ environment, probe }));

    expect(response.status).toBe(404);
    expect(probe).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer wrong-token", `Basic ${token}`, `Bearer ${token}x`])(
    "rejects a missing or invalid token (%s) without querying the database",
    async (authorization) => {
      const probe = vi.fn(async () => true);
      const response = await handleKeepalive(request(authorization), deps({ probe }));

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(probe).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the token is not configured", async () => {
    const response = await handleKeepalive(request(`Bearer ${token}`), deps({ expectedToken: undefined }));
    expect(response.status).toBe(500);
  });

  it("returns 503 when the probe query fails or finds no row", async () => {
    const failed = await handleKeepalive(
      request(`Bearer ${token}`),
      deps({ probe: async () => Promise.reject(new Error("connection refused")) }),
    );
    const empty = await handleKeepalive(request(`Bearer ${token}`), deps({ probe: async () => false }));

    expect(failed.status).toBe(503);
    expect(empty.status).toBe(503);
  });
});
