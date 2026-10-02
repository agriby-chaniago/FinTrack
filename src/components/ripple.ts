// Square ripples (PRD v0.22 P10): one pointerdown listener adds a ripple to the nearest
// enabled `.ripple-host` (buttons, cards, + Catat), spreading from where it was pressed.
// Hosts are positioned and clip the ripple; reduced motion adds none.
export function installRipple(): () => void {
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const host = event.target instanceof Element ? event.target.closest<HTMLElement>(".ripple-host") : null;
    if (!host || host.matches(":disabled")) return;
    const box = host.getBoundingClientRect();
    const size = Math.max(box.width, box.height) * 2.2;
    const wave = document.createElement("span");
    wave.className = "ripple-wave";
    wave.setAttribute("aria-hidden", "true");
    wave.style.cssText = `left:${event.clientX - box.left - size / 2}px;top:${event.clientY - box.top - size / 2}px;width:${size}px;height:${size}px`;
    host.append(wave);
    wave.addEventListener("animationend", () => wave.remove(), { once: true });
  };
  document.addEventListener("pointerdown", onPointerDown);
  return () => document.removeEventListener("pointerdown", onPointerDown);
}
