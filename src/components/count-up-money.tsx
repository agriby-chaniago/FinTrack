"use client";

// Headline amount that counts up once when it appears (PRD v0.21 P9), or rolls to its
// new value when it changed since it was last seen in this session (v0.22 P10). The server
// HTML holds the exact amount. On a full page load the inline script counts it up before
// the first paint; after a client navigation the layout effect counts or rolls. Screen
// readers get the exact amount only; the moving copy is hidden from them.
import { useId, useRef } from "react";

import { InlineScript } from "@/components/inline-script";
import { useRollingAmount } from "@/components/rolling-money";
import { COUNT_UP_MS, countUpText, runCountUp } from "@/lib/count-up";
import { money } from "@/lib/format";
import { parseIdrDecimal } from "@/lib/money";

const countUp = (el: HTMLElement) => runCountUp(el, countUpText, COUNT_UP_MS);

export function CountUpMoney({ value }: { value: string }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const text = money(value);
  // A changed amount rolls from what was last seen instead of counting up again.
  useRollingAmount(ref, "personal-cash", text, countUp);
  return (
    <>
      <span className="sr-only">{text}</span>
      <span id={id} ref={ref} aria-hidden="true" data-count-up={parseIdrDecimal(value).toString()} suppressHydrationWarning className="sweep-line tabular whitespace-nowrap">
        {text}
      </span>
      <InlineScript html={`(${runCountUp})(document.getElementById(${JSON.stringify(id)}),${countUpText},${COUNT_UP_MS})`} />
    </>
  );
}
