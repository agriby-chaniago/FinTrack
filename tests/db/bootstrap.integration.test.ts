// Owner bootstrap and recovery (PRD: Bootstrap owner pertama, Stable owner identity).
import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { bindOwner } from "@/server/bootstrap/bind-owner";

const admin = postgres(process.env.ADMIN_DATABASE_URL!, { max: 10, onnotice: () => {} });
const users = Array.from({ length: 5 }, () => randomUUID());
const [first, second] = users;

async function ownerRows() {
  return admin<{ auth_user_id: string | null }[]>`select auth_user_id from fintrack.app_owner`;
}

beforeEach(async () => {
  await admin`delete from fintrack.app_owner`;
  for (const id of users) {
    await admin`
      insert into auth.users (id, aud, role, email)
      values (${id}, 'authenticated', 'authenticated', ${`${id}@fintrack.test`})
      on conflict (id) do nothing`;
  }
});

afterAll(async () => {
  await admin`delete from fintrack.app_owner`;
  await admin`delete from auth.users where id = any(${users})`;
  await admin.end();
});

describe("bindOwner", () => {
  it("creates the owner once and is idempotent for the same Auth user", async () => {
    expect(await bindOwner(admin, first)).toBe("CREATED");
    expect(await bindOwner(admin, first)).toBe("ALREADY_BOUND");
    expect(await ownerRows()).toEqual([{ auth_user_id: first }]);
  });

  it("hard-fails when a different Auth user tries to bind", async () => {
    await bindOwner(admin, first);
    await expect(bindOwner(admin, second)).rejects.toMatchObject({ code: "OWNER_BOUND_TO_DIFFERENT_USER" });
    await expect(bindOwner(admin, second, { rebind: true })).rejects.toMatchObject({
      code: "OWNER_BOUND_TO_DIFFERENT_USER",
    });
    expect(await ownerRows()).toEqual([{ auth_user_id: first }]);
  });

  it("never produces a second owner under concurrent bootstrap runs", async () => {
    const results = await Promise.allSettled(users.map((id) => bindOwner(admin, id)));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await ownerRows()).toHaveLength(1);
  });

  it("requires an explicit rebind after the Auth user was deleted", async () => {
    await bindOwner(admin, first);
    await admin`delete from auth.users where id = ${first}`;
    expect(await ownerRows()).toEqual([{ auth_user_id: null }]);

    await expect(bindOwner(admin, second)).rejects.toMatchObject({ code: "BINDING_EMPTY_REBIND_REQUIRED" });
    expect(await bindOwner(admin, second, { rebind: true })).toBe("REBOUND");
    expect(await ownerRows()).toEqual([{ auth_user_id: second }]);
  });

  it("rejects unknown Auth users and malformed identifiers", async () => {
    await expect(bindOwner(admin, randomUUID())).rejects.toMatchObject({ code: "AUTH_USER_NOT_FOUND" });
    await expect(bindOwner(admin, "not-a-uuid")).rejects.toMatchObject({ code: "INVALID_UUID" });
    expect(await ownerRows()).toEqual([]);
  });

  it("does not create any financial configuration", async () => {
    await bindOwner(admin, first);
    const tables = await admin<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'fintrack' and c.relkind = 'r' and c.relname <> 'app_owner'`;
    for (const { relname } of tables) {
      const [{ count }] = await admin.unsafe<{ count: string }[]>(`select count(*)::text as count from fintrack."${relname}"`);
      expect(count, relname).toBe("0");
    }
  });
});
