"use client";

// "Perlu dilakukan" on Beranda (PRD v0.22 P10). It remembers the tasks it showed in this
// session; a task that is gone on return was done elsewhere, so it comes back for a moment,
// is checked off and struck through, then folds away. A full page load has no memory, so
// nothing replays, and reduced motion never replays.
import { useEffect, useState, type ReactNode } from "react";

import { AnimatedItem, AnimatedList } from "./motion";
import { DrawnCheck, SectionTitle } from "./ui";

export type TaskSnapshot = { key: string; title: string; detail: string };

/** How long a replayed task stays before it folds away; it starts once its section has arrived. */
const CELEBRATE_MS = 1500;
let shownBefore: TaskSnapshot[] | null = null;

function finishedSince(current: TaskSnapshot[]): TaskSnapshot[] {
  if (!shownBefore || typeof window === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) return [];
  const open = new Set(current.map((task) => task.key));
  return shownBefore.filter((task) => !open.has(task.key));
}

export function TaskSection({ tasks, footer, children }: { tasks: TaskSnapshot[]; footer?: ReactNode; children: ReactNode }) {
  const [finished, setFinished] = useState(() => finishedSince(tasks));
  // Keeps the section until the last replayed task has folded away, even when no task is left.
  const [leaving, setLeaving] = useState(finished.length > 0);
  useEffect(() => {
    shownBefore = tasks;
  }, [tasks]);
  useEffect(() => {
    if (finished.length === 0) return;
    const timer = setTimeout(() => setFinished([]), CELEBRATE_MS);
    return () => clearTimeout(timer);
  }, [finished.length]);
  if (tasks.length === 0 && !leaving) return null;
  return (
    <section aria-labelledby="tasks-title">
      <SectionTitle icon="checklist">
        <span id="tasks-title">Perlu dilakukan</span>
      </SectionTitle>
      <AnimatedList className="cascade divide-y divide-border border border-border bg-surface" onExitComplete={() => setLeaving(false)}>
        {finished.map((task) => (
          <AnimatedItem key={`done-${task.key}`} className="cascade-skip" leaveX={40} decorative>
            <div className="celebrate celebrate-later flex min-h-14 items-center gap-3 px-4 py-3">
              <span className="flex size-5 shrink-0 items-center justify-center bg-primary text-primary-content">
                <DrawnCheck className="size-3.5" />
              </span>
              <span>
                <span className="relative block font-medium">
                  {task.title}
                  <span className="celebrate-strike absolute inset-x-0 top-1/2 h-0.5 bg-current" />
                </span>
                <span className="block text-sm text-muted">{task.detail}</span>
              </span>
            </div>
          </AnimatedItem>
        ))}
        {children}
      </AnimatedList>
      {footer}
    </section>
  );
}
