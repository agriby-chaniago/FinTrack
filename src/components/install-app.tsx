"use client";

import { useState, useSyncExternalStore } from "react";

import { installState, promptInstall, subscribeInstall } from "@/lib/install-prompt";

import { buttonClass, Icon } from "./ui";

/**
 * Passive install help for Pengaturan (PRD: Installable website). Chrome and
 * Edge get a real install button; Safari on iPhone has no install API, so it
 * keeps one line of instructions.
 */
export function InstallApp() {
  // The server cannot know the browser, so nothing renders until hydration.
  const state = useSyncExternalStore(subscribeInstall, installState, () => null);
  const [pending, setPending] = useState(false);

  if (state === null) return <div className="min-h-11" />;

  if (state === "standalone" || state === "installed") {
    return (
      <p className="flex min-h-11 items-center gap-2 text-sm text-success-fg">
        <Icon name="check" />
        {state === "standalone" ? "FinTrack sudah terpasang dan sedang dibuka sebagai aplikasi." : "FinTrack terpasang. Buka dari layar utama atau daftar aplikasi."}
      </p>
    );
  }

  if (state === "available") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted">Buka FinTrack langsung dari layar utama, tanpa kolom alamat browser.</p>
        <button
          type="button"
          className={buttonClass.primary}
          disabled={pending}
          onClick={async () => {
            setPending(true);
            await promptInstall();
            setPending(false);
          }}
        >
          <Icon name="arrowDown" /> Pasang FinTrack
        </button>
      </div>
    );
  }

  return (
    <p className="text-sm text-muted">
      {state === "ios"
        ? "Di iPhone: buka FinTrack di Safari, ketuk tombol Bagikan, lalu Tambah ke Layar Utama."
        : "Pilih Instal aplikasi atau Tambahkan ke layar utama dari menu browser. Jika FinTrack sudah terpasang, buka dari layar utama."}
    </p>
  );
}
