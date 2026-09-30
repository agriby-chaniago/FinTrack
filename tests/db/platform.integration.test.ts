// Integration tests for the platform security spike (audit HB-1, HB-2).
// They require `supabase start`, `pnpm db:migrate`, and `pnpm db:provision`,
// and they reset the local app_owner row.
import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createRuntimeDb } from "@/server/db/client";
import { OwnerAccessError, withOwnerDb } from "@/server/db/owner";
import { queryKeepaliveProbe } from "@/server/ops/keepalive";

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests`);
  return value;
};

const adminUrl = env("ADMIN_DATABASE_URL");
const pooledAppUrl = env("DATABASE_URL");
const directAppUrl = `postgresql://fintrack_app:${encodeURIComponent(env("FINTRACK_APP_DB_PASSWORD"))}@127.0.0.1:54322/postgres`;
const directProbeUrl = `postgresql://fintrack_probe:${encodeURIComponent(env("FINTRACK_PROBE_DB_PASSWORD"))}@127.0.0.1:54322/postgres`;
const directBackupUrl = `postgresql://fintrack_backup:${encodeURIComponent(env("FINTRACK_BACKUP_DB_PASSWORD"))}@127.0.0.1:54322/postgres`;

const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
const probe = postgres(directProbeUrl, { max: 1, onnotice: () => {} });
const backup = postgres(directBackupUrl, { max: 1, onnotice: () => {} });

// max: 1 forces every transaction onto the same client connection so leaks would surface.
const pooledRuntime = createRuntimeDb(pooledAppUrl, { max: 1 });
const directRuntime = createRuntimeDb(directAppUrl, { max: 1 });

const ownerAuthId = randomUUID();
const strangerAuthId = randomUUID();
let ownerId: string;

async function ensureAuthUser(id: string): Promise<void> {
  await admin`
    insert into auth.users (id, aud, role, email)
    values (${id}, 'authenticated', 'authenticated', ${`${id}@fintrack.test`})
    on conflict (id) do nothing`;
}

beforeAll(async () => {
  await ensureAuthUser(ownerAuthId);
  await ensureAuthUser(strangerAuthId);
});

beforeEach(async () => {
  await ensureAuthUser(ownerAuthId);
  await admin`delete from fintrack.app_owner`;
  const [row] = await admin<{ id: string }[]>`
    insert into fintrack.app_owner (auth_user_id, bound_at) values (${ownerAuthId}, now()) returning id`;
  ownerId = row.id;
});

afterAll(async () => {
  await admin`delete from fintrack.app_owner`;
  await admin`delete from auth.users where id in (${ownerAuthId}, ${strangerAuthId})`;
  await Promise.all([admin.end(), probe.end(), backup.end()]);
  await Promise.all([
    pooledRuntime.$client.end(),
    directRuntime.$client.end(),
  ]);
});

describe("database roles", () => {
  it("runtime role is not superuser, cannot bypass RLS, and owns no fintrack relation", async () => {
    const [role] = await admin<{ rolsuper: boolean; rolbypassrls: boolean; rolinherit: boolean }[]>`
      select rolsuper, rolbypassrls, rolinherit from pg_roles where rolname = 'fintrack_app'`;
    const owned = await admin`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('fintrack', 'ops') and pg_get_userbyid(c.relowner) = 'fintrack_app'`;

    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolinherit: false });
    expect(owned).toHaveLength(0);
  });

  it("Data API roles cannot reach the fintrack or ops schemas", async () => {
    const [privileges] = await admin<Record<string, boolean>[]>`
      select has_schema_privilege('anon', 'fintrack', 'USAGE') as anon_fintrack,
             has_schema_privilege('authenticated', 'fintrack', 'USAGE') as authenticated_fintrack,
             has_schema_privilege('authenticated', 'ops', 'USAGE') as authenticated_ops,
             has_table_privilege('authenticated', 'fintrack.app_owner', 'SELECT') as authenticated_app_owner`;

    expect(Object.values(privileges).every((granted) => granted === false)).toBe(true);
  });

  it("every fintrack and ops table has row level security enabled", async () => {
    const tables = await admin<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('fintrack', 'ops') and c.relkind = 'r'`;

    expect(tables.length).toBeGreaterThan(0);
    expect(tables.filter((table) => !table.relrowsecurity)).toEqual([]);
  });
});

describe.each([
  ["transaction pooler", () => pooledRuntime],
  ["direct connection", () => directRuntime],
])("withOwnerDb through the %s", (_label, runtime) => {
  it("resolves the bound owner and reads the owner row under RLS", async () => {
    const result = await withOwnerDb(runtime(), { sub: ownerAuthId }, async (tx, principal) => {
      const rows = await tx.execute<{ id: string }>(sql`select id from fintrack.app_owner`);
      return { principal, ids: rows.map((row) => row.id) };
    });

    expect(result.principal).toEqual({ ownerId, authUserId: ownerAuthId });
    expect(result.ids).toEqual([ownerId]);
  });

  it("rejects a valid Supabase user who is not the owner and exposes no rows", async () => {
    await expect(withOwnerDb(runtime(), { sub: strangerAuthId }, async () => "unreachable")).rejects.toMatchObject({
      code: "NOT_OWNER",
      status: 403,
    });

    const visible = await runtime().transaction(async (tx) => {
      await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: strangerAuthId })}, true)`);
      return tx.execute(sql`select id from fintrack.app_owner`);
    });
    expect(visible).toHaveLength(0);
  });

  it("fails closed with APP_NOT_INITIALIZED when the binding is missing", async () => {
    await admin`update fintrack.app_owner set auth_user_id = null`;

    await expect(withOwnerDb(runtime(), { sub: ownerAuthId }, async () => "unreachable")).rejects.toMatchObject({
      code: "APP_NOT_INITIALIZED",
      status: 503,
    });
  });

  it("rejects malformed identities before touching the database", async () => {
    await expect(withOwnerDb(runtime(), { sub: "not-a-uuid" }, async () => "unreachable")).rejects.toBeInstanceOf(
      OwnerAccessError,
    );
  });

  it("does not leak claims to the next transaction after commit or rollback", async () => {
    const claimsAfter = async () => {
      const [row] = await runtime().execute<{ sub: string | null; owner: string | null; role: string }>(
        sql`select fintrack.request_auth_user_id() as sub, fintrack.current_owner_id() as owner, current_user as role`,
      );
      return row;
    };

    await withOwnerDb(runtime(), { sub: ownerAuthId }, async () => undefined);
    expect(await claimsAfter()).toEqual({ sub: null, owner: null, role: "fintrack_app" });

    await expect(
      withOwnerDb(runtime(), { sub: ownerAuthId }, async () => {
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");
    expect(await claimsAfter()).toEqual({ sub: null, owner: null, role: "fintrack_app" });
  });

  it("cannot modify the owner binding", async () => {
    const error = await withOwnerDb(runtime(), { sub: ownerAuthId }, (tx) =>
      tx.execute(sql`update fintrack.app_owner set auth_user_id = ${strangerAuthId}`),
    ).catch((caught: unknown) => caught);

    // Drizzle wraps the driver error; the PostgreSQL message is on `cause`.
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).cause)).toMatch(/permission denied for table app_owner/);
  });
});

describe("owner identity lifecycle", () => {
  it("allows only one app_owner row", async () => {
    await expect(admin`insert into fintrack.app_owner (auth_user_id) values (null)`).rejects.toThrow(
      /app_owner_singleton_key_unique/,
    );
  });

  it("clears the binding without deleting the owner when the Auth user is deleted", async () => {
    await admin`delete from auth.users where id = ${ownerAuthId}`;

    const rows = await admin<{ id: string; auth_user_id: string | null }[]>`
      select id, auth_user_id from fintrack.app_owner`;
    expect(rows).toEqual([{ id: ownerId, auth_user_id: null }]);

    await expect(withOwnerDb(pooledRuntime, { sub: ownerAuthId }, async () => "unreachable")).rejects.toMatchObject({
      code: "APP_NOT_INITIALIZED",
    });
  });
});

describe("operational roles", () => {
  it("keepalive probe reads only the non-financial probe relation", async () => {
    expect(await queryKeepaliveProbe(process.env.KEEPALIVE_DATABASE_URL)).toBe(true);
    await expect(probe`select id from fintrack.app_owner`).rejects.toThrow(/permission denied for schema fintrack/);
    await expect(probe`insert into ops.keepalive_probe (id, label) values (1, 'x')`).rejects.toThrow(
      /permission denied/,
    );
  });

  it("backup role reads every row regardless of RLS but cannot write", async () => {
    const rows = await backup`select id from fintrack.app_owner`;
    expect(rows).toHaveLength(1);
    await expect(backup`delete from fintrack.app_owner`).rejects.toThrow(/permission denied/);
  });
});
