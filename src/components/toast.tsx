"use client";

// Supplemental success toast (PRD: Feedback dan responsive behavior). The
// relevant surface still shows the real status; the toast only confirms it and
// is announced through one persistent polite live region.
import { AnimatePresence, m } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { useSlide } from "./motion";
import { Icon } from "./ui";

const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const rise = useSlide(8);
  const show = useCallback((message: string) => setToast({ id: Date.now(), message }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-[calc(8.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center md:inset-x-auto md:bottom-6 md:right-6">
        <AnimatePresence>
          {toast ? (
            <m.p key={toast.id} initial={{ opacity: 0, y: rise }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: rise }} className="flex items-center gap-2 bg-text px-4 py-3 text-sm font-medium text-canvas shadow-lg">
              <Icon name="check" className="size-4" />
              {toast.message}
            </m.p>
          ) : null}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
