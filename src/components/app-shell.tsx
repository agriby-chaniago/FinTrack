"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, m } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

// Loaded on every app page so the browser install prompt is kept for Pengaturan.
import "@/lib/install-prompt";
import { applyTheme, type ThemePreference } from "@/lib/theme";

import { Brand } from "./brand";
import { useSlide } from "./motion";
import { ToastProvider } from "./toast";
import { Icon, type IconName } from "./ui";

const destinations: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Beranda", icon: "home" },
  { href: "/rutinitas", label: "Rutinitas", icon: "repeat" },
  { href: "/aktivitas", label: "Aktivitas", icon: "list" },
  { href: "/akun", label: "Akun", icon: "wallet" },
];

// The plus glyph leaves a fifth of its box empty on each side; the nudge centers the drawn icon and label.
const catatIcon = <Icon name="plus" className="-ml-1 size-4" />;

const catatActions: { href: string; label: string; description: string; icon: IconName }[] = [
  { href: "/catat/pengeluaran", label: "Pengeluaran khusus", description: "Vape dan pengeluaran tidak rutin", icon: "arrowDown" },
  { href: "/catat/transfer", label: "Transfer", description: "Transfer yang sudah benar-benar dilakukan", icon: "swap" },
  { href: "/catat/saldo", label: "Update saldo", description: "Konfirmasi saldo sesuai aplikasi bank/e-wallet", icon: "check" },
  { href: "/catat/dana-titipan", label: "Dana titipan", description: "Uang milik orang lain yang Anda pegang", icon: "user" },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

/**
 * True once the first page has fully loaded and the browser is idle. The tabs
 * are prefetched only then, so opening the app never competes with loading
 * the page the owner is looking at.
 */
function useWarmedUp(): boolean {
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Safari has no requestIdleCallback; a short timeout stands in for it.
    const idle = (callback: () => void) =>
      typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(callback, { timeout: 2000 }) : setTimeout(callback, 300);
    const start = () => idle(() => !cancelled && setWarm(true));
    // A streamed page fires `load` only after its data has arrived.
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
    };
  }, []);
  return warm;
}

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
      className="inline-flex min-h-11 w-full items-center gap-2 px-3 text-sm text-muted hover:bg-surface-subtle"
    >
      <Icon name={theme === "dark" ? "clock" : "check"} className="size-4" />
      {themeCycle[theme].label}
    </button>
  );
}

/** `+ Catat` sheet: the panel slides up and fades; the dialog closes after the exit animation. */
function CatatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const slide = useSlide(24);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && open && !dialog.open) dialog.showModal();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        // Escape runs the exit animation first; onExitComplete then closes the dialog.
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      data-closing={open ? undefined : ""}
      aria-labelledby="catat-title"
      className="sheet m-0 mt-auto w-full max-w-none bg-transparent p-0 text-text md:m-auto md:max-w-md"
    >
      <AnimatePresence onExitComplete={() => ref.current?.close()}>
        {open ? (
          <m.div key="sheet" initial={{ opacity: 0, y: slide }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: slide }} className="bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="catat-title" className="text-lg font-semibold">
                Catat
              </h2>
              <button type="button" onClick={onClose} className="inline-flex size-11 items-center justify-center hover:bg-surface-subtle" aria-label="Tutup">
                <Icon name="close" className="size-5" />
              </button>
            </div>
            <ul className="space-y-1">
              {catatActions.map((action) => (
                <li key={action.href}>
                  <Link href={action.href} onClick={onClose} className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-surface-subtle">
                    <span className="inline-flex size-9 items-center justify-center bg-primary-soft text-primary">
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
          </m.div>
        ) : null}
      </AnimatePresence>
    </dialog>
  );
}

/**
 * Four primary destinations in the same order on desktop (sidebar) and mobile
 * (bottom navigation). `+ Catat` is an action, never a fifth tab; Pengaturan
 * is secondary (PRD: Information architecture).
 *
 * Once the first page has loaded (useWarmedUp), the destinations are fully
 * prefetched (data included) so switching tabs is instant. Prefetched pages
 * stay fresh for `staleTimes.static` (next.config), and every saved change
 * purges them (useMutation → revalidateAppData).
 */
export function AppShell({ children, theme }: { children: ReactNode; theme: ThemePreference }) {
  const pathname = usePathname();
  const [catatOpen, setCatatOpen] = useState(false);
  const warm = useWarmedUp();

  return (
    <ToastProvider>
      <div className="flex min-h-full flex-1">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
          <Brand className="px-3 text-lg font-semibold" />
          <button type="button" onClick={() => setCatatOpen(true)} className="mx-1 mt-5 inline-flex h-11 items-center justify-center gap-2 bg-primary font-medium text-primary-content hover:bg-primary-hover">
            {catatIcon} Catat
          </button>
          <nav aria-label="Navigasi utama" className="mt-5 flex-1">
            <ul className="space-y-1">
              {destinations.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    prefetch={warm}
                    aria-current={isActive(pathname, item.href) ? "page" : undefined}
                    className="flex min-h-11 items-center gap-3 px-3 text-sm font-medium text-muted hover:bg-surface-subtle aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary"
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
              className="flex min-h-11 items-center gap-3 px-3 text-sm text-muted hover:bg-surface-subtle aria-[current=page]:text-primary"
            >
              <Icon name="settings" className="size-5" />
              Pengaturan
            </Link>
            <ThemeToggle initial={theme} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-surface px-4 md:hidden">
            <Brand className="font-semibold" />
            <Link href="/pengaturan" className="inline-flex size-11 items-center justify-center hover:bg-surface-subtle" aria-label="Pengaturan">
              <Icon name="settings" className="size-5" />
            </Link>
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-32 pt-6 md:px-8 md:pb-12">{children}</main>
        </div>

        <button
          type="button"
          onClick={() => setCatatOpen(true)}
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 inline-flex h-12 items-center gap-2 bg-primary px-5 font-medium text-primary-content shadow-lg hover:bg-primary-hover md:hidden"
        >
          {catatIcon} Catat
        </button>

        <nav aria-label="Navigasi utama" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
          <ul className="grid grid-cols-4">
            {destinations.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  prefetch={warm}
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
    </ToastProvider>
  );
}
