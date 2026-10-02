"use client";

// Rolling digits (PRD v0.22 P10). An amount seen earlier in this session that has changed
// rolls from that value to the new one like an odometer; a full page load has no memory and
// shows the exact amount at once. The exact text stays in the DOM for layout, selection, and
// screen readers; the rolling copy is an aria-hidden overlay removed when every digit lands.
import { useLayoutEffect, useRef, type RefObject } from "react";

import { money } from "@/lib/format";
import { odometerCells } from "@/lib/odometer";

const ROLL_MS = 1040;
const PLACE_DELAY_MS = 40;
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const seen = new Map<string, string>();

/** Rolls `host` from the text `from` to its current text `to`; returns a cleanup that lands it at once. */
export function rollDigits(host: HTMLElement, from: string, to: string): () => void {
  if (from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  const overlay = document.createElement("span");
  overlay.className = "odo-overlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.color = getComputedStyle(host).color;
  const animations: Animation[] = [];
  for (const cell of odometerCells(from, to)) {
    const span = document.createElement("span");
    overlay.append(span);
    if (!cell.digit) {
      span.dataset.char = cell.text;
      continue;
    }
    span.className = "odo";
    const column = document.createElement("span");
    span.append(column);
    animations.push(
      column.animate([{ transform: `translateY(${-cell.from}lh)` }, { transform: `translateY(${-cell.to}lh)` }], {
        duration: ROLL_MS,
        delay: cell.place * PLACE_DELAY_MS,
        easing: SPRING,
        fill: "both",
      }),
    );
  }
  host.style.color = "transparent";
  host.append(overlay);
  const land = () => {
    overlay.remove();
    host.style.color = "";
  };
  Promise.all(animations.map((animation) => animation.finished)).then(land, () => {});
  return () => {
    animations.forEach((animation) => animation.cancel());
    land();
  };
}

/**
 * Rolls `ref` to `text` from what it showed before, or from what was last seen under `key`
 * in this session; otherwise runs `still` (for example the headline count-up). The origin is
 * kept per text, so React's development double effects replay the same roll.
 */
export function useRollingAmount(ref: RefObject<HTMLElement | null>, key: string, text: string, still?: (el: HTMLElement) => void) {
  const origin = useRef<{ text: string; from: string | undefined } | null>(null);
  useLayoutEffect(() => {
    if (origin.current?.text !== text) {
      origin.current = { text, from: origin.current ? origin.current.text : seen.get(key) };
      seen.set(key, text);
    }
    const el = ref.current;
    if (!el) return;
    const from = origin.current.from;
    if (from && from !== text) return rollDigits(el, from, text);
    still?.(el);
  }, [ref, key, text, still]);
}

/** A balance that rolls when it changed since it was last seen under `memoryKey`. */
export function RollingMoney({ value, memoryKey }: { value: string; memoryKey: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const text = money(value);
  useRollingAmount(ref, memoryKey, text);
  return (
    <span ref={ref} data-rolling={memoryKey} className="tabular relative whitespace-nowrap">
      {text}
    </span>
  );
}
