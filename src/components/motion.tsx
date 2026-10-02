"use client";

// Motion primitives (PRD v0.20 P3). Only `m` components with the domAnimation
// bundle are used. With `prefers-reduced-motion: reduce`, slides start at their
// final position and folds become plain fades, so nothing moves or jumps; only
// opacity changes remain. Every wrapper uses `initial={false}`: server markup and
// first render always show the final state.
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/** PRD Motion: 160–220 ms, ease-out. */
const enter = { duration: 0.2, ease: "easeOut" } as const;
const quick = { duration: 0.16, ease: "easeOut" } as const;

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user" transition={enter}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

/** Slide distance in pixels, or 0 when the user prefers reduced motion. */
export function useSlide(distance: number): number {
  return useReducedMotion() ? 0 : distance;
}

/** Shown and hidden states for content that folds open and closed (a fade only under reduced motion). */
function useFold() {
  const reduced = useReducedMotion();
  return {
    shown: reduced ? { opacity: 1 } : { opacity: 1, height: "auto", transitionEnd: { overflow: "visible" } },
    hidden: reduced ? { opacity: 0 } : { opacity: 0, height: 0, overflow: "hidden" },
  };
}

/** Expands and collapses its content (expand/collapse detail). */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const fold = useFold();
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <m.div key="collapse" initial={fold.hidden} animate={fold.shown} exit={fold.hidden}>
          {children}
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Replaces one state of a surface with the next, folding the old one away first. */
export function Swap({ swapKey, children }: { swapKey: string; children: ReactNode }) {
  const fold = useFold();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <m.div key={swapKey} initial={fold.hidden} animate={fold.shown} exit={fold.hidden} transition={quick}>
        {children}
      </m.div>
    </AnimatePresence>
  );
}

const stepVariants = {
  enter: (offset: number) => ({ opacity: 0, x: offset }),
  center: { opacity: 1, x: 0 },
  exit: (offset: number) => ({ opacity: 0, x: -offset }),
};

/**
 * Guided-flow steps: forward slides in from the right, back from the left. The old
 * step is popped out of the layout and fades while the new one arrives, so the step
 * area is never blank; the parent must be positioned.
 */
export function StepTransition({ step, direction, children }: { step: number; direction: 1 | -1; children: ReactNode }) {
  const offset = direction * useSlide(16);
  return (
    <AnimatePresence mode="popLayout" initial={false} custom={offset}>
      <m.div key={step} custom={offset} variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.18, ease: "easeOut" }}>
        {children}
      </m.div>
    </AnimatePresence>
  );
}

/** Fades new content in whenever `revealKey` changes. */
export function Reveal({ revealKey, children }: { revealKey: string; children: ReactNode }) {
  const rise = useSlide(8);
  return (
    <AnimatePresence initial={false}>
      <m.div key={revealKey} initial={{ opacity: 0, y: rise }} animate={{ opacity: 1, y: 0 }}>
        {children}
      </m.div>
    </AnimatePresence>
  );
}

/** A list whose items fold away when they leave, so the rest of the list moves up. */
export function AnimatedList({ className, children, onExitComplete }: { className?: string; children: ReactNode; onExitComplete?: () => void }) {
  return (
    <ul className={className}>
      <AnimatePresence initial={false} onExitComplete={onExitComplete}>
        {children}
      </AnimatePresence>
    </ul>
  );
}

/**
 * `leaveX` also slides the item sideways as it folds away (a finished task, PRD v0.22 P10);
 * a `decorative` item is hidden from screen readers.
 */
export function AnimatedItem({ children, className, leaveX = 0, decorative = false }: { children: ReactNode; className?: string; leaveX?: number; decorative?: boolean }) {
  const fold = useFold();
  const x = useSlide(leaveX);
  const exit = x ? { ...fold.hidden, x, transition: { duration: 0.52, ease: [0.2, 0.7, 0.2, 1] as const } } : fold.hidden;
  return (
    <m.li className={className} aria-hidden={decorative || undefined} initial={fold.hidden} animate={fold.shown} exit={exit}>
      {children}
    </m.li>
  );
}
