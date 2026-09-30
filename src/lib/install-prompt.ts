// Browser install prompt (PRD: Installable website). Chromium fires
// `beforeinstallprompt` once per page load, possibly before Pengaturan is
// open, so the event is captured app-wide and kept here until used. Calling
// preventDefault() keeps install help passive: no browser mini-infobar.

/** Chromium-only event; not part of the TypeScript DOM library. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/**
 * - `available`: the browser can show its install dialog now.
 * - `installed`: installed during this visit.
 * - `standalone`: already running as the installed app.
 * - `ios`: Safari on iPhone/iPad only installs through Share.
 * - `manual`: no prompt yet (unsupported browser, already installed, or not
 *   eligible yet), so the browser menu is the way.
 */
export type InstallState = "available" | "installed" | "standalone" | "ios" | "manual";

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    notify();
  });
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function installState(): InstallState {
  if (installed) return "installed";
  if (isStandalone()) return "standalone";
  if (deferred) return "available";
  return isIos() ? "ios" : "manual";
}

/** Shows the browser's install dialog. The event can be used only once. */
export async function promptInstall(): Promise<void> {
  const event = deferred;
  if (!event) return;
  try {
    await event.prompt();
    if ((await event.userChoice).outcome === "accepted") installed = true;
  } catch {
    // Already used or refused by the browser: the menu steps still work.
  } finally {
    deferred = null;
    notify();
  }
}
