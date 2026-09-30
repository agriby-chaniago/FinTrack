"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { applyTheme, type ThemePreference } from "@/lib/theme";

import { Icon, type IconName } from "./ui";

const destinations: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Beranda", icon: "home" },
  { href: "/rutinitas", label: "Rutinitas", icon: "repeat" },
  { href: "/aktivitas", label: "Aktivitas", icon: "list" },
  { href: "/akun", label: "Akun", icon: "wallet" },
];

const catatActions: { href: string; label: string; description: string; icon: IconName }[] = [
  { href: "/catat/pengeluaran", label: "Pengeluaran khusus", description: "Vape dan pengeluaran tidak rutin", icon: "arrowDown" },
  { href: "/catat/transfer", label: "Transfer", description: "Transfer yang sudah benar-benar dilakukan", icon: "swap" },
  { href: "/catat/saldo", label: "Update saldo", description: "Konfirmasi saldo sesuai aplikasi bank/e-wallet", icon: "check" },
  { href: "/catat/dana-titipan", label: "Dana titipan", description: "Uang milik orang lain yang Anda pegang", icon: "user" },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

const themeCycle: Record<ThemePreference, { next: ThemePreference; label: string }> = {
  system: { next: "light", label: "Tema: ikuti sistem" },
  light: { next: "dark", label: "Tema: terang" },
  dark: { next: "system", label: "Tema: gelap" },
};

/** Cycles Ikuti sistem → Terang → Gelap; the full choice lives in Pengaturan. */
function ThemeToggle({ initial }: { initial: ThemePreference }) {
  const [theme, setTheme] = useState(initial);
  return (
    <button
      type="button"
      onClick={() => {
        const next = themeCycle[theme].next;
        applyTheme(next);
        setTheme(next);
      }}
      className="inline-flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-muted hover:bg-surface-subtle"
    >
      <Icon name={theme === "dark" ? "clock" : "check"} className="size-4" />
      {themeCycle[theme].label}
    </button>
  );
}

function CatatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="catat-title"
      className="m-0 mt-auto w-full max-w-none rounded-t-2xl bg-surface p-0 text-text shadow-xl backdrop:bg-black/40 md:m-auto md:max-w-md md:rounded-2xl"
    >
      <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="catat-title" className="text-lg font-semibold">
            Catat
          </h2>
          <button type="button" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface-subtle" aria-label="Tutup">
            <Icon name="close" className="size-5" />
          </button>
        </div>
        <ul className="space-y-1">
          {catatActions.map((action) => (
            <li key={action.href}>
              <Link href={action.href} onClick={onClose} className="flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-subtle">
                <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <Icon name={action.icon} />
                </span>
                <span>
                  <span className="block font-medium">{action.label}</span>
                  <span className="block text-sm text-muted">{action.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  );
}

/**
 * Four primary destinations in the same order on desktop (sidebar) and mobile
 * (bottom navigation). `+ Catat` is an action, never a fifth tab; Pengaturan
 * is secondary (PRD: Information architecture).
 */
export function AppShell({ children, theme }: { children: ReactNode; theme: ThemePreference }) {
  const pathname = usePathname();
  const [catatOpen, setCatatOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-1">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
        <p className="px-3 text-lg font-semibold">FinTrack</p>
        <button type="button" onClick={() => setCatatOpen(true)} className="mx-1 mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary font-medium text-primary-content hover:bg-primary-hover">
          <Icon name="plus" /> Catat
        </button>
        <nav aria-label="Navigasi utama" className="mt-5 flex-1">
          <ul className="space-y-1">
            {destinations.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted hover:bg-surface-subtle aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary"
                >
                  <Icon name={item.icon} className="size-5" />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="space-y-1 border-t border-border pt-3">
          <Link
            href="/pengaturan"
            aria-current={pathname.startsWith("/pengaturan") ? "page" : undefined}
            className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-muted hover:bg-surface-subtle aria-[current=page]:text-primary"
          >
            <Icon name="settings" className="size-5" />
            Pengaturan
          </Link>
          <ThemeToggle initial={theme} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-surface px-4 md:hidden">
          <span className="font-semibold">FinTrack</span>
          <Link href="/pengaturan" className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface-subtle" aria-label="Pengaturan">
            <Icon name="settings" className="size-5" />
          </Link>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-32 pt-6 md:px-8 md:pb-12">{children}</main>
      </div>

      <button
        type="button"
        onClick={() => setCatatOpen(true)}
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-5 font-medium text-primary-content shadow-lg hover:bg-primary-hover md:hidden"
      >
        <Icon name="plus" /> Catat
      </button>

      <nav aria-label="Navigasi utama" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid grid-cols-4">
          {destinations.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className="flex h-16 flex-col items-center justify-center gap-1 text-xs text-muted aria-[current=page]:text-primary"
              >
                <Icon name={item.icon} className="size-5" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <CatatSheet open={catatOpen} onClose={() => setCatatOpen(false)} />
    </div>
  );
}
