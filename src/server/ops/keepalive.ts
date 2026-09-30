import { createHash, timingSafeEqual } from "node:crypto";

import { Pool } from "pg";

import { databaseSsl } from "@/server/db/supabase-ca";

export type KeepaliveDeps = {
  /** Deployment environment, e.g. Vercel's VERCEL_ENV. */
  readonly environment: string | undefined;
  readonly expectedToken: string | undefined;
  /** Performs one real read-only query against the non-financial probe relation. */
  readonly probe: () => Promise<boolean>;
};

const noStore = { "Cache-Control": "no-store" } as const;

function errorResponse(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: noStore });
}

function tokensMatch(provided: string, expected: string): boolean {
  // Hash both values so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function handleKeepalive(request: Request, deps: KeepaliveDeps): Promise<Response> {
  if (deps.environment !== "production") {
    return errorResponse(404, "NOT_AVAILABLE");
  }
  if (!deps.expectedToken) {
    return errorResponse(500, "KEEPALIVE_NOT_CONFIGURED");
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match || !tokensMatch(match[1], deps.expectedToken)) {
    return errorResponse(401, "INVALID_KEEPALIVE_TOKEN");
  }

  try {
    if (!(await deps.probe())) {
      return errorResponse(503, "PROBE_EMPTY");
    }
  } catch {
    return errorResponse(503, "PROBE_FAILED");
  }

  return new Response(null, { status: 204, headers: noStore });
}

let probePool: Pool | undefined;

/** Reads the probe row as fintrack_probe; this role cannot see financial tables. */
export async function queryKeepaliveProbe(url: string | undefined): Promise<boolean> {
  if (!url) {
    throw new Error("KEEPALIVE_DATABASE_URL is not configured");
  }
  probePool ??= new Pool({ connectionString: url, ssl: databaseSsl(url), max: 1 });
  const result = await probePool.query("select id from ops.keepalive_probe where id = 1");
  return result.rows.length === 1;
}
