// Pages and loading skeletons of the four main tabs. Between the tabs they slide with
// the tab order (PRD v0.22 P10: the links carry `tab-forward` or `tab-back`); every other
// transition, such as a refresh after a change or a browser back, leaves them still.
// A prefetched page slides in itself; otherwise its skeleton slides in and the page replaces it.
import { ViewTransition, type ReactNode } from "react";

const slide = { "tab-forward": "tab-forward", "tab-back": "tab-back", default: "none" };

export function TabSlide({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter={slide} exit={slide} default="none">
      {children}
    </ViewTransition>
  );
}

export function TabPage({ className, children }: { className: string; children: ReactNode }) {
  return (
    <TabSlide>
      <div className={className}>{children}</div>
    </TabSlide>
  );
}
