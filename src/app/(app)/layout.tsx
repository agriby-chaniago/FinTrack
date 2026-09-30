import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { signOut } from "@/app/(auth)/actions";
import { AppShell } from "@/components/app-shell";
import { Alert, buttonClass } from "@/components/ui";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { getOnboardingState } from "@/server/application/onboarding";
import { runAsPageOwner } from "@/server/auth/page-owner";

const blocked = {
  NOT_OWNER: "Akun ini tidak memiliki akses ke FinTrack.",
  APP_NOT_INITIALIZED: "FinTrack belum diinisialisasi. Owner perlu di-bootstrap terlebih dahulu.",
} as const;

/** Authenticated app shell. Every page below still loads data through requireOwner(). */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const owner = await runAsPageOwner((tx, principal) => getOnboardingState(tx, principal.ownerId, new Date()));
  if (owner.status === "NO_SESSION") redirect("/login");
  if (owner.status !== "OWNER") {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16">
        <Alert tone="danger" title="Akses ditolak">
          {blocked[owner.status]}
        </Alert>
        <form action={signOut.bind(null, "local")} className="mt-4">
          <button type="submit" className={buttonClass.secondary}>
            Keluar
          </button>
        </form>
      </main>
    );
  }
  if (owner.value.status !== "CONFIRMED") redirect("/onboarding");
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return <AppShell theme={theme}>{children}</AppShell>;
}
