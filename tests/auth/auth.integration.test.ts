// Private authentication acceptance (PRD: Acceptance scenario private authentication)
// against local Supabase Auth. Requires `pnpm env:local` so the API keys are present.
import { randomUUID } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getSession } from "@/app/api/v1/session/route";
import { POST as logout } from "@/app/api/v1/session/logout/route";
import { bindOwner } from "@/server/bootstrap/bind-owner";
import { databaseSsl } from "@/server/db/supabase-ca";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const adminSql = postgres(process.env.ADMIN_DATABASE_URL!, { ssl: databaseSsl(process.env.ADMIN_DATABASE_URL!), max: 1, onnotice: () => {} });
const authAdmin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

const password = `pw-${randomUUID()}`;
const ownerEmail = `owner-${randomUUID()}@fintrack.test`;
const strangerEmail = `stranger-${randomUUID()}@fintrack.test`;
let ownerId = "";
let strangerId = "";

/** A fresh device: its own in-memory session storage. */
function device(): SupabaseClient {
  return createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(email: string): Promise<{ client: SupabaseClient; accessToken: string }> {
  const client = device();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error("no session");
  return { client, accessToken: data.session.access_token };
}

/** Signs in through @supabase/ssr and returns the resulting browser Cookie header. */
async function cookieHeaderFor(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
}

function sessionRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:3000/api/v1/session", { headers });
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

beforeAll(async () => {
  const owner = await authAdmin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
  const stranger = await authAdmin.auth.admin.createUser({ email: strangerEmail, password, email_confirm: true });
  if (owner.error || stranger.error) throw owner.error ?? stranger.error;
  ownerId = owner.data.user.id;
  strangerId = stranger.data.user.id;
});

beforeEach(async () => {
  await adminSql`truncate fintrack.app_owner cascade`;
  await bindOwner(adminSql, ownerId);
});

afterAll(async () => {
  await adminSql`truncate fintrack.app_owner cascade`;
  await authAdmin.auth.admin.deleteUser(ownerId);
  await authAdmin.auth.admin.deleteUser(strangerId);
  await adminSql.end();
});

describe("Supabase Auth configuration", () => {
  it("disables public signup and anonymous sign-in", async () => {
    const client = device();
    const signup = await client.auth.signUp({ email: `public-${randomUUID()}@fintrack.test`, password });
    const anonymous = await client.auth.signInAnonymously();

    expect(signup.error?.code).toBe("signup_disabled");
    expect(anonymous.error).not.toBeNull();
  });
});

describe("GET /api/v1/session", () => {
  it("returns the owner principal for a valid Bearer token", async () => {
    const { accessToken } = await signIn(ownerEmail);
    const response = await getSession(sessionRequest({ authorization: `Bearer ${accessToken}` }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(((await response.json()) as { data: { authUserId: string } }).data.authUserId).toBe(ownerId);
  });

  it("accepts the segment context Next.js passes to static routes", async () => {
    // Next.js 16 passes `{ params }` resolving to undefined for routes without dynamic segments.
    const { accessToken } = await signIn(ownerEmail);
    const segment = { params: Promise.resolve(undefined) } as unknown as { params: Promise<Record<string, string>> };
    const response = await getSession(sessionRequest({ authorization: `Bearer ${accessToken}` }), segment);

    expect(response.status).toBe(200);
  });

  it("returns the same owner principal for the website cookie session", async () => {
    const cookie = await cookieHeaderFor(ownerEmail);
    const response = await getSession(sessionRequest({ cookie }));

    expect(response.status).toBe(200);
    expect(((await response.json()) as { data: { authUserId: string } }).data.authUserId).toBe(ownerId);
  });

  it("keeps sessions on several devices valid at the same time", async () => {
    const [a, b] = await Promise.all([signIn(ownerEmail), signIn(ownerEmail)]);
    for (const { accessToken } of [a, b]) {
      expect((await getSession(sessionRequest({ authorization: `Bearer ${accessToken}` }))).status).toBe(200);
    }
  });

  it("rejects a valid Supabase user who is not the owner with 403", async () => {
    const { accessToken } = await signIn(strangerEmail);
    const response = await getSession(sessionRequest({ authorization: `Bearer ${accessToken}` }));

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("NOT_OWNER");
  });

  it.each([
    ["no credential", {}],
    ["a forged token", { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.invalid" }],
    ["a malformed header", { authorization: "Token abc" }],
  ])("rejects %s with 401 before any data access", async (_label, headers) => {
    const response = await getSession(sessionRequest(headers));
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("INVALID_IDENTITY");
  });

  it("rejects a cookie and a Bearer token that belong to different users", async () => {
    const cookie = await cookieHeaderFor(ownerEmail);
    const { accessToken } = await signIn(strangerEmail);
    const response = await getSession(sessionRequest({ cookie, authorization: `Bearer ${accessToken}` }));

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("AMBIGUOUS_IDENTITY");
  });

  it("fails closed with 503 when the owner is not bootstrapped", async () => {
    await adminSql`truncate fintrack.app_owner cascade`;
    const { accessToken } = await signIn(ownerEmail);
    const response = await getSession(sessionRequest({ authorization: `Bearer ${accessToken}` }));

    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("APP_NOT_INITIALIZED");
  });

  it("keeps the same stable owner after the email address changes", async () => {
    const [before] = await adminSql<{ id: string }[]>`select id from fintrack.app_owner`;
    const newEmail = `owner-${randomUUID()}@fintrack.test`;
    await authAdmin.auth.admin.updateUserById(ownerId, { email: newEmail, email_confirm: true });

    const client = device();
    const { data } = await client.auth.signInWithPassword({ email: newEmail, password });
    const response = await getSession(sessionRequest({ authorization: `Bearer ${data.session!.access_token}` }));

    expect(((await response.json()) as { data: { ownerId: string } }).data.ownerId).toBe(before.id);
    await authAdmin.auth.admin.updateUserById(ownerId, { email: ownerEmail, email_confirm: true });
  });
});

describe("POST /api/v1/session/logout", () => {
  function logoutRequest(accessToken: string, scope: string): Request {
    return new Request("http://127.0.0.1:3000/api/v1/session/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ scope }),
    });
  }

  it("ends only this device's session for scope=local", async () => {
    const a = await signIn(ownerEmail);
    const b = await signIn(ownerEmail);

    expect((await logout(logoutRequest(a.accessToken, "local"))).status).toBe(204);

    expect((await a.client.auth.refreshSession()).error).not.toBeNull();
    expect((await b.client.auth.refreshSession()).error).toBeNull();
  });

  it("ends every session for scope=global", async () => {
    const a = await signIn(ownerEmail);
    const b = await signIn(ownerEmail);

    expect((await logout(logoutRequest(a.accessToken, "global"))).status).toBe(204);

    expect((await a.client.auth.refreshSession()).error).not.toBeNull();
    expect((await b.client.auth.refreshSession()).error).not.toBeNull();
  });

  it("rejects an unknown scope", async () => {
    const a = await signIn(ownerEmail);
    const response = await logout(logoutRequest(a.accessToken, "everything"));
    expect(response.status).toBe(422);
  });
});
