// Headline count-up (PRD v0.21 P9). Both functions are also serialized into an
// inline script for the first paint (Function.prototype.toString), so each must
// stay self-contained: no imports, no module-level values, browser globals only.

export const COUNT_UP_MS = 600;

/** Text at `progress` (0–1) of a count-up toward `minor` sen: eased out, whole thousands of rupiah, BigInt only. */
export function countUpText(minor: bigint, progress: number): string {
  const negative = minor < 0n;
  const rupiah = (negative ? -minor : minor) / 100n;
  const t = Math.min(Math.max(progress, 0), 1);
  const eased = 1 - Math.pow(1 - t, 3);
  const thousands = (rupiah * BigInt(Math.round(eased * 10000))) / 10_000_000n;
  const grouped = (thousands * 1000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative && thousands > 0n ? "−" : ""}Rp${grouped}`;
}

/**
 * Counts `el` up once, from Rp0 to the exact text it already shows. The amount in
 * sen is in `data-count-up`. Does nothing under reduced motion, stops as soon as
 * React renders a different amount, and waits while the element is still hidden
 * (a streamed boundary not yet revealed).
 */
export function runCountUp(el: HTMLElement | null, text: (minor: bigint, progress: number) => string, duration: number): void {
  if (!el || el.hasAttribute("data-counted")) return;
  el.setAttribute("data-counted", "");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const amount = el.getAttribute("data-count-up") ?? "0";
  const minor = BigInt(amount);
  const exact = el.textContent;
  el.textContent = text(minor, 0);
  let start = -1;
  const frame = (now: number) => {
    if (!el.isConnected || el.getAttribute("data-count-up") !== amount) return;
    if (el.getClientRects().length === 0) {
      requestAnimationFrame(frame);
      return;
    }
    if (start < 0) start = now;
    const progress = (now - start) / duration;
    el.textContent = progress >= 1 ? exact : text(minor, progress);
    if (progress < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
