import type { DigestOutcome } from "@/server/application/reminders";

import { tokensMatch } from "./token";

const noStore = { "Cache-Control": "no-store" } as const;

function errorResponse(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: noStore });
}

export type ReminderDeps = {
  /** Deployment environment, e.g. Vercel's VERCEL_ENV. */
  readonly environment: string | undefined;
  readonly expectedToken: string | undefined;
  /** Sends today's digest for the bound owner, or explains why nothing was sent. */
  readonly deliver: () => Promise<DigestOutcome>;
};

/** POST /api/internal/reminders: the token-protected trigger for the daily digest (PRD v0.20 P6). */
export async function handleReminder(request: Request, deps: ReminderDeps): Promise<Response> {
  if (deps.environment !== "production") {
    return errorResponse(404, "NOT_AVAILABLE");
  }
  if (!deps.expectedToken) {
    return errorResponse(500, "REMINDER_NOT_CONFIGURED");
  }

  const match = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match || !tokensMatch(match[1], deps.expectedToken)) {
    return errorResponse(401, "INVALID_REMINDER_TOKEN");
  }

  let outcome: DigestOutcome;
  try {
    outcome = await deps.deliver();
  } catch {
    // The failure code stays generic: Telegram errors could carry the bot URL.
    return errorResponse(502, "DIGEST_NOT_SENT");
  }
  if (outcome === "NO_OWNER") {
    return errorResponse(503, "APP_NOT_INITIALIZED");
  }
  return Response.json({ data: { status: outcome } }, { status: 200, headers: noStore });
}
