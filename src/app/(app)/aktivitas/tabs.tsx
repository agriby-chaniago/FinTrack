import Link from "next/link";

/** Riwayat | Laporan (PRD v0.20 P5): two views of Aktivitas, not new destinations. */
export function AktivitasTabs({ active }: { active: "riwayat" | "laporan" }) {
  const tab = (key: "riwayat" | "laporan", href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className="flex min-h-11 flex-1 items-center justify-center border border-control px-4 text-sm font-medium aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-content md:flex-none"
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Tampilan aktivitas" className="mb-6 flex">
      {tab("riwayat", "/aktivitas", "Riwayat")}
      {tab("laporan", "/aktivitas/laporan", "Laporan")}
    </nav>
  );
}
