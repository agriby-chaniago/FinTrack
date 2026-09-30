import type { Sql } from "postgres";

export type BindOwnerResult = "CREATED" | "ALREADY_BOUND" | "REBOUND";

export type BindOwnerErrorCode =
  | "AUTH_USER_NOT_FOUND"
  | "OWNER_BOUND_TO_DIFFERENT_USER"
  | "BINDING_EMPTY_REBIND_REQUIRED"
  | "INVALID_UUID";

export class BindOwnerError extends Error {
  readonly code: BindOwnerErrorCode;

  constructor(code: BindOwnerErrorCode, message: string) {
    super(message);
    this.name = "BindOwnerError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Trusted, idempotent owner bootstrap. Runs only with the admin connection.
 *
 * - No owner yet: creates the singleton owner bound to `authUserId`
 * - Same Auth user already bound: succeeds without changes
 * - Different Auth user bound: hard failure
 * - Binding cleared (Auth user deleted): only an explicit `rebind` restores it
 *
 * It never creates accounts, balances, rules, or financial events.
 */
export async function bindOwner(
  sql: Sql,
  authUserId: string,
  options: { rebind?: boolean } = {},
): Promise<BindOwnerResult> {
  if (!uuidPattern.test(authUserId)) {
    throw new BindOwnerError("INVALID_UUID", "auth user id must be a UUID");
  }

  return sql.begin(async (tx) => {
    // Serialises concurrent bootstrap runs so a second owner can never appear.
    await tx`select pg_advisory_xact_lock(hashtext('fintrack.app_owner.bootstrap'))`;

    const authUsers = await tx`select id from auth.users where id = ${authUserId}`;
    if (authUsers.length === 0) {
      throw new BindOwnerError("AUTH_USER_NOT_FOUND", "the Supabase Auth user does not exist");
    }

    const owners = await tx<{ id: string; auth_user_id: string | null }[]>`
      select id, auth_user_id from fintrack.app_owner for update`;
    const owner = owners[0];

    if (!owner) {
      await tx`insert into fintrack.app_owner (auth_user_id, bound_at) values (${authUserId}, now())`;
      return "CREATED";
    }
    if (owner.auth_user_id === authUserId) {
      return "ALREADY_BOUND";
    }
    if (owner.auth_user_id !== null) {
      throw new BindOwnerError("OWNER_BOUND_TO_DIFFERENT_USER", "the owner is already bound to a different Auth user");
    }
    if (!options.rebind) {
      throw new BindOwnerError(
        "BINDING_EMPTY_REBIND_REQUIRED",
        "the owner binding is empty; verify ownership and rerun with --rebind",
      );
    }
    await tx`update fintrack.app_owner set auth_user_id = ${authUserId}, bound_at = now() where id = ${owner.id}`;
    return "REBOUND";
  }) as Promise<BindOwnerResult>;
}
