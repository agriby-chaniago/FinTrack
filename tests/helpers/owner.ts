// Shared setup for integration tests: an Auth user bound as owner with the
// locked onboarding fixture confirmed.
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { confirmOnboarding, saveOnboardingDraft, type ConfirmationSummary } from "@/server/application/onboarding";
import { bindOwner } from "@/server/bootstrap/bind-owner";
import { createRuntimeDb, type RuntimeDb } from "@/server/db/client";
import { withOwnerDb, type AuthPrincipal, type OwnerTx } from "@/server/db/owner";
import { defaultOnboardingDraft, type OnboardingDraft } from "@/server/domain/onboarding";
import { databaseSsl } from "@/server/db/supabase-ca";

export type TestClients = { admin: postgres.Sql; authAdmin: SupabaseClient; runtime: RuntimeDb };

export function testClients(): TestClients {
  return {
    admin: postgres(process.env.ADMIN_DATABASE_URL!, { ssl: databaseSsl(process.env.ADMIN_DATABASE_URL!), max: 1, onnotice: () => {} }),
    authAdmin: createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    runtime: createRuntimeDb(process.env.DATABASE_URL!, { max: 2 }),
  };
}

export async function closeClients(clients: TestClients): Promise<void> {
  await clients.admin.end();
  await clients.runtime.$client.end();
}

export type TestUser = { id: string; email: string; password: string; accessToken: string };

export async function createAuthUser(authAdmin: SupabaseClient, prefix = "owner"): Promise<TestUser> {
  const email = `${prefix}-${randomUUID()}@fintrack.test`;
  const password = `pw-${randomUUID()}`;
  const created = await authAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return { id: created.data.user.id, email, password, accessToken: signedIn.data.session.access_token };
}

/** PRD "Locked onboarding and external-funds fixture": BCA holds Rp431.999,93 for Dosen. */
export function fixtureDraft(cutoverAt: string): OnboardingDraft {
  const draft = defaultOnboardingDraft(new Date(cutoverAt));
  draft.cutoverAt = cutoverAt;
  draft.accounts[0].physicalBalance = "0";
  draft.accounts[1].physicalBalance = "831999.93";
  draft.accounts[2].physicalBalance = "0";
  draft.externals = [{ accountKey: "monthly", subjectName: "Dosen", amount: "431999.93" }];
  draft.routines.subscriptions = [{ name: "Langganan", expectedDay: 5, expectedAmount: "400000", includeCurrentCycle: false }];
  draft.routines.retainedFloor = "400000";
  return draft;
}

export function asOwner<T>(runtime: RuntimeDb, userId: string, work: (tx: OwnerTx, principal: AuthPrincipal) => Promise<T>) {
  return withOwnerDb(runtime, { sub: userId }, work);
}

export type ConfirmedOwner = ConfirmationSummary & { ownerId: string; dosenHoldingId: string };

/** Clears all owner data, binds `userId`, and confirms the fixture onboarding. */
export async function resetWithConfirmedFixture(
  clients: TestClients,
  userId: string,
  cutoverAt: string,
  adjust: (draft: OnboardingDraft) => void = () => {},
): Promise<ConfirmedOwner> {
  await clients.admin`truncate fintrack.app_owner cascade`;
  await bindOwner(clients.admin, userId);
  const draft = fixtureDraft(cutoverAt);
  adjust(draft);
  const summary = await asOwner(clients.runtime, userId, async (tx, principal) => {
    await saveOnboardingDraft(tx, principal.ownerId, draft, 0);
    return { ...(await confirmOnboarding(tx, principal.ownerId, 1, new Date())), ownerId: principal.ownerId };
  });
  const [holding] = await clients.admin<{ id: string }[]>`
    select h.id from fintrack.external_holding h
    join fintrack.external_subject s on s.id = h.subject_id where s.normalized_name = 'dosen'`;
  return { ...summary, dosenHoldingId: holding.id };
}
