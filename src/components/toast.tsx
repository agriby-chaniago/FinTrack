"use client";

// Supplemental success toast (PRD: Feedback dan responsive behavior). The
// relevant surface still shows the real status; the toast only confirms it and
// is announced through one persistent polite live region.
import { AnimatePresence, m } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { useSlide } from "./motion";
import { DrawnCheck } from "./ui";

/** How long a toast stays; its countdown line drains over the same time (PRD v0.21 P9). */
const TOAST_MS = 3500;

const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const rise = useSlide(20);
  const show = useCallback((message: string) => setToast({ id: Date.now(), message }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-[calc(8.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center md:inset-x-auto md:bottom-6 md:right-6">
        <AnimatePresence>
          {toast ? (
            <m.div key={toast.id} initial={{ opacity: 0, y: rise }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: rise }} transition={{ duration: 0.24, ease: [0.34, 1.56, 0.64, 1] }} className="bg-text text-sm font-medium text-canvas shadow-lg">
              <p className="flex items-center gap-2 px-4 py-3">
                <DrawnCheck className="size-4" />
                {toast.message}
              </p>
              <span aria-hidden="true" className="toast-timer block h-0.5 bg-current opacity-40" style={{ animationDuration: `${TOAST_MS}ms` }} />
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
