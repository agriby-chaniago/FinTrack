import { sql } from "drizzle-orm";

import type { RuntimeDb } from "./client";

/** Claims whose signature and expiry were already verified by the auth adapter. */
export type VerifiedClaims = {
  readonly sub: string;
  readonly [claim: string]: unknown;
};

export type AuthPrincipal = {
  readonly ownerId: string;
  readonly authUserId: string;
};

type RuntimeTx = Parameters<Parameters<RuntimeDb["transaction"]>[0]>[0];

declare const ownerScoped: unique symbol;

/**
 * Transaction handle that carries verified owner claims. Protected repositories
 * accept only this type, so a bare runtime client cannot be passed to them.
 */
export type OwnerTx = RuntimeTx & { readonly [ownerScoped]: true };

export type OwnerAccessErrorCode = "INVALID_IDENTITY" | "APP_NOT_INITIALIZED" | "NOT_OWNER";

const statusByCode: Record<OwnerAccessErrorCode, 401 | 403 | 503> = {
  INVALID_IDENTITY: 401,
  NOT_OWNER: 403,
  APP_NOT_INITIALIZED: 503,
};

export class OwnerAccessError extends Error {
  readonly code: OwnerAccessErrorCode;
  readonly status: 401 | 403 | 503;

  constructor(code: OwnerAccessErrorCode) {
    super(code);
    this.name = "OwnerAccessError";
    this.code = code;
    this.status = statusByCode[code];
  }
}

/** Read-only snapshot reads (export) use `repeatable read` + `read only`. */
export type OwnerTransactionConfig = Parameters<RuntimeDb["transaction"]>[1];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opens a transaction, installs the verified claims transaction-locally,
 * resolves the owner, and runs `work` with the same transaction handle.
 * The claims disappear on commit or rollback, so they never leak to the next
 * request that reuses the pooled connection.
 */
export async function withOwnerDb<T>(
  db: RuntimeDb,
  claims: VerifiedClaims,
  work: (tx: OwnerTx, principal: AuthPrincipal) => Promise<T>,
  config?: OwnerTransactionConfig,
): Promise<T> {
  if (typeof claims.sub !== "string" || !uuidPattern.test(claims.sub)) {
    throw new OwnerAccessError("INVALID_IDENTITY");
  }

  return db.transaction(async (tx) => {
    const ownerTx = tx as OwnerTx;
    // One round trip: the claims are installed by the FROM subquery, which runs
    // before the select list reads them through the owner functions.
    const rows = await tx.execute<OwnerRow>(sql`
      select fintrack.owner_access_status() as status,
             fintrack.current_owner_id() as owner_id,
             fintrack.request_auth_user_id() as auth_user_id
      from (select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)) as installed`);
    return work(ownerTx, principalFrom(rows[0]));
  }, config);
}

type OwnerRow = { status: string; owner_id: string | null; auth_user_id: string | null };

/** Resolves the owner principal for the claims installed on `tx`, or fails closed. */
export async function requireOwner(tx: OwnerTx): Promise<AuthPrincipal> {
  const rows = await tx.execute<OwnerRow>(
    sql`select fintrack.owner_access_status() as status,
               fintrack.current_owner_id() as owner_id,
               fintrack.request_auth_user_id() as auth_user_id`,
  );
  return principalFrom(rows[0]);
}

function principalFrom(row: OwnerRow | undefined): AuthPrincipal {
  if (!row || row.status === "NOT_INITIALIZED") {
    throw new OwnerAccessError("APP_NOT_INITIALIZED");
  }
  if (row.status !== "OWNER" || !row.owner_id || !row.auth_user_id) {
    throw new OwnerAccessError("NOT_OWNER");
  }
  return { ownerId: row.owner_id, authUserId: row.auth_user_id };
}
