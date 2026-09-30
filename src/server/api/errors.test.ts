import { describe, expect, it, vi } from "vitest";

import { OwnerAccessError } from "@/server/db/owner";

import { ApiError, toErrorResponse } from "./errors";

describe("toErrorResponse", () => {
  it.each([
    [new ApiError("AMBIGUOUS_IDENTITY"), 401, "AMBIGUOUS_IDENTITY"],
    [new OwnerAccessError("NOT_OWNER"), 403, "NOT_OWNER"],
    [new OwnerAccessError("APP_NOT_INITIALIZED"), 503, "APP_NOT_INITIALIZED"],
    [new ApiError("VALIDATION_FAILED", { field: "scope" }), 422, "VALIDATION_FAILED"],
  ])("maps %s to the JSON contract", async (error, status, code) => {
    const response = toErrorResponse(error, "req-1");
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(body.error).toMatchObject({ code, requestId: "req-1" });
    expect(typeof body.error.message).toBe("string");
  });

  it("hides unexpected errors behind INTERNAL_ERROR without logging their message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = toErrorResponse(new Error("saldo Rp400.000 connection string secret"), "req-2");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(log.mock.calls.flat().join(" ")).not.toContain("secret");
    log.mockRestore();
  });
});
