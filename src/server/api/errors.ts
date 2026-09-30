import { OwnerAccessError } from "@/server/db/owner";

/** Stable API error codes (docs/implementation-plan.md §7). */
export type ApiErrorCode =
  | "INVALID_IDENTITY"
  | "AMBIGUOUS_IDENTITY"
  | "NOT_OWNER"
  | "APP_NOT_INITIALIZED"
  | "VALIDATION_FAILED"
  | "INTERNAL_ERROR";

const statusByCode: Record<ApiErrorCode, number> = {
  INVALID_IDENTITY: 401,
  AMBIGUOUS_IDENTITY: 401,
  NOT_OWNER: 403,
  APP_NOT_INITIALIZED: 503,
  VALIDATION_FAILED: 422,
  INTERNAL_ERROR: 500,
};

const messageByCode: Record<ApiErrorCode, string> = {
  INVALID_IDENTITY: "Sesi tidak valid atau sudah berakhir.",
  AMBIGUOUS_IDENTITY: "Permintaan membawa dua identitas yang berbeda.",
  NOT_OWNER: "Akun ini tidak memiliki akses ke FinTrack.",
  APP_NOT_INITIALIZED: "FinTrack belum diinisialisasi.",
  VALIDATION_FAILED: "Input tidak valid.",
  INTERNAL_ERROR: "Terjadi kesalahan pada server.",
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  readonly status: number;

  constructor(code: ApiErrorCode, details?: unknown) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
    this.status = statusByCode[code];
  }
}

export const noStoreHeaders = { "Cache-Control": "no-store" } as const;

/** Maps any thrown value to the JSON error contract. Never leaks internals. */
export function toErrorResponse(error: unknown, requestId: string): Response {
  const apiError =
    error instanceof ApiError
      ? error
      : error instanceof OwnerAccessError
        ? new ApiError(error.code)
        : new ApiError("INTERNAL_ERROR");

  if (apiError.code === "INTERNAL_ERROR") {
    // Log only the request ID and error class: no payloads, tokens, or amounts.
    console.error(`[${requestId}] unhandled ${error instanceof Error ? error.name : typeof error}`);
  }

  const body: { error: { code: ApiErrorCode; message: string; requestId: string; details?: unknown } } = {
    error: { code: apiError.code, message: messageByCode[apiError.code], requestId },
  };
  if (apiError.details !== undefined) body.error.details = apiError.details;

  return Response.json(body, {
    status: apiError.status,
    headers: { ...noStoreHeaders, "X-Request-Id": requestId },
  });
}
