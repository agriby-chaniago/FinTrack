import { redirect } from "next/navigation";

import { signOut } from "@/app/(auth)/actions";
import { getOnboardingState } from "@/server/application/onboarding";
import { runAsPageOwner } from "@/server/auth/page-owner";

const blockedMessages = {
  NOT_OWNER: "Akun ini tidak memiliki akses ke FinTrack.",
  APP_NOT_INITIALIZED: "FinTrack belum diinisialisasi. Owner perlu di-bootstrap terlebih dahulu.",
} as const;

export default async function HomePage() {
  const owner = await runAsPageOwner((tx, principal) => getOnboardingState(tx, principal.ownerId, new Date()));
  if (owner.status === "NO_SESSION") redirect("/login");
  if (owner.status === "OWNER" && owner.value.status !== "CONFIRMED") redirect("/onboarding");

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 md:px-8">
      <p className="text-sm text-muted">FinTrack</p>
      <h1 className="mt-1 text-2xl font-semibold">Beranda</h1>

      <section className="mt-6 rounded-xl border border-border bg-surface p-4 md:p-6">
        {owner.status === "OWNER" ? (
          <>
            <p className="font-medium">Onboarding selesai.</p>
            <p className="mt-1 text-sm text-muted">
              Saldo awal dan rutinitas sudah tersimpan. Dashboard tersedia pada tahap berikutnya.
            </p>
          </>
        ) : (
          <p role="alert" className="text-danger-fg">
            {blockedMessages[owner.status]}
          </p>
        )}
      </section>

      <section className="mt-6 flex flex-col gap-3 sm:flex-row" aria-label="Keamanan">
        <form action={signOut.bind(null, "local")}>
          <button
            type="submit"
            className="h-11 w-full rounded-lg border border-control px-4 text-sm font-medium sm:w-auto"
          >
            Keluar dari perangkat ini
          </button>
        </form>
        <form action={signOut.bind(null, "global")}>
          <button
            type="submit"
            className="h-11 w-full rounded-lg border border-control px-4 text-sm font-medium sm:w-auto"
          >
            Keluar dari semua perangkat
          </button>
        </form>
      </section>
    </main>
  );
}
