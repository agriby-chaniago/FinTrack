import { redirect } from "next/navigation";

import { getOnboardingState } from "@/server/application/onboarding";
import { runAsPageOwner } from "@/server/auth/page-owner";

import { OnboardingFlow } from "./onboarding-flow";

export default async function OnboardingPage() {
  const result = await runAsPageOwner((tx, principal) => getOnboardingState(tx, principal.ownerId, new Date()));
  if (result.status === "NO_SESSION") redirect("/login");
  if (result.status !== "OWNER") redirect("/");

  const state = result.value;
  if (state.status === "CONFIRMED") redirect("/");

  return <OnboardingFlow initialDraft={state.draft} initialVersion={state.version} initialReview={state.review} />;
}
