"use client";

// A monthly occurrence resolved right here flashes green with a drawn check (PRD v0.22 P10).
// The flash sits on an inner box so the list item's own entrance animation is not replaced.
import { useState, type ReactNode } from "react";

import { DrawnCheck } from "./ui";

export function ResolveFlash({ status, className, children }: { status: string; className: string; children: ReactNode }) {
  const [shown, setShown] = useState(status);
  const [flash, setFlash] = useState(false);
  if (shown !== status) {
    setShown(status);
    setFlash(shown === "PENDING");
  }
  return (
    <li>
      <div
        className={`relative ${className} ${flash ? "celebrate" : ""}`}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setFlash(false);
        }}
      >
        {flash ? (
          <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center bg-success-bg text-success-fg">
            <DrawnCheck className="size-4" />
          </span>
        ) : null}
        {children}
      </div>
    </li>
  );
}
