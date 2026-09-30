import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { parseIdrDecimal, toIdrDecimal } from "@/lib/money";
import { recordingContext } from "@/server/application/recording-context";
import { listTargets, transferSuggestions } from "@/server/application/transfers";
import { runAsPageOwner } from "@/server/auth/page-owner";

import { TransferForm } from "./transfer-form";

export default async function TransferPage({ searchParams }: { searchParams: Promise<{ target?: string }> }) {
  const { target: targetId } = await searchParams;
  const result = await runAsPageOwner(async (tx, { ownerId }) => ({
    context: await recordingContext(tx, ownerId),
    targets: await listTargets(tx, ownerId),
    suggestions: await transferSuggestions(tx, ownerId),
  }));
  if (result.status !== "OWNER") redirect("/login");
  const { context, targets, suggestions } = result.value;
  const target = targets.find((t) => t.id === targetId && t.version?.isActionable) ?? null;
  let prefill: { sourceAccountId: string; destinationAccountId: string; amount: string | null } | null = null;
  if (target) {
    const now = suggestions.find((s) => s.route.sourceAccountId === target.route.sourceAccountId)?.transferNow ?? "0";
    const remaining = parseIdrDecimal(target.remaining);
    const capped = parseIdrDecimal(now) < remaining ? parseIdrDecimal(now) : remaining;
    prefill = { sourceAccountId: target.route.sourceAccountId, destinationAccountId: target.route.destinationAccountId, amount: capped > 0n ? toIdrDecimal(capped) : null };
  }

  return (
    <>
      <PageHeader title="Transfer" description="Catat transfer yang sudah benar-benar dilakukan di aplikasi bank atau e-wallet." />
      <TransferForm
        context={context}
        prefill={prefill}
        routeHints={suggestions.map((s) => ({ sourceAccountId: s.route.sourceAccountId, destinationAccountId: s.route.destinationAccountId, outstanding: s.outstanding, transferNow: s.transferNow }))}
      />
    </>
  );
}
