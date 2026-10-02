"use client";

// Headline amount that counts up once when it appears (PRD v0.21 P9). The server
// HTML holds the exact amount. On a full page load the inline script counts it up
// before the first paint; after a client navigation the layout effect does. Screen
// readers get the exact amount only; the counting copy is hidden from them.
import { useId, useLayoutEffect, useRef } from "react";

import { InlineScript } from "@/components/inline-script";
import { COUNT_UP_MS, countUpText, runCountUp } from "@/lib/count-up";
import { money } from "@/lib/format";
import { parseIdrDecimal } from "@/lib/money";

export function CountUpMoney({ value }: { value: string }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => runCountUp(ref.current, countUpText, COUNT_UP_MS), []);
  return (
    <>
      <span className="sr-only">{money(value)}</span>
      <span id={id} ref={ref} aria-hidden="true" data-count-up={parseIdrDecimal(value).toString()} suppressHydrationWarning className="tabular whitespace-nowrap">
        {money(value)}
      </span>
      <InlineScript html={`(${runCountUp})(document.getElementById(${JSON.stringify(id)}),${countUpText},${COUNT_UP_MS})`} />
    </>
  );
}
