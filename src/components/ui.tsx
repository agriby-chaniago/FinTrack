// Quiet Ledger primitives (PRD: Visual language dan component behavior).
// Server-safe: no client hooks here.
import Link from "next/link";
import type { ReactNode } from "react";

import { balanceStatusLabel } from "@/lib/labels";
import { isNegative, money } from "@/lib/format";

const paths: Record<string, string> = {
  check: "M7.5 13.5 4 10l-1.4 1.4 4.9 4.9L17.4 6.4 16 5z",
  calculator: "M5 2h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm1 2v3h8V4H6Zm0 5v2h2V9H6Zm3 0v2h2V9H9Zm3 0v2h2V9h-2Zm-6 3v2h2v-2H6Zm3 0v2h2v-2H9Zm3 0v5h2v-5h-2Zm-6 3v2h5v-2H6Z",
  clock: "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm-1 2v5l4 2.4.8-1.3L11 10.4V6H9Z",
  warning: "M10 2 1 18h18L10 2Zm-.9 6h1.8v5H9.1V8Zm0 6.5h1.8v1.8H9.1v-1.8Z",
  alert: "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-1 4h2v6H9V6Zm0 7h2v2H9v-2Z",
  plus: "M9 4h2v5h5v2h-5v5H9v-5H4V9h5V4Z",
  home: "M10 2 2 9h2v8h5v-5h2v5h5V9h2L10 2Z",
  repeat: "M4 7h9V4l4 4-4 4V9H6v3H4V7Zm12 6H7v3l-4-4 4-4v3h7V8h2v5Z",
  list: "M3 4h2v2H3V4Zm4 0h10v2H7V4ZM3 9h2v2H3V9Zm4 0h10v2H7V9Zm-4 5h2v2H3v-2Zm4 0h10v2H7v-2Z",
  wallet: "M3 5a2 2 0 0 1 2-2h10v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5Zm2 0v1h8V5H5Zm8 6a1 1 0 1 0 2 0 1 1 0 0 0-2 0Z",
  settings: "M11 2h-2l-.4 2.1a6 6 0 0 0-1.5.9L5.1 4.3 3.7 5.7l.7 2A6 6 0 0 0 3.5 9.2L1.5 10v2l2 .5a6 6 0 0 0 .9 1.5l-.7 2 1.4 1.4 2-.7a6 6 0 0 0 1.5.9L9 20h2l.4-2.1a6 6 0 0 0 1.5-.9l2 .7 1.4-1.4-.7-2a6 6 0 0 0 .9-1.5l2-.5v-2l-2-.5a6 6 0 0 0-.9-1.5l.7-2-1.4-1.4-2 .7a6 6 0 0 0-1.5-.9L11 2Zm-1 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z",
  arrowUp: "M10 3 4 9l1.4 1.4L9 6.8V17h2V6.8l3.6 3.6L16 9l-6-6Z",
  arrowDown: "M10 17 4 11l1.4-1.4L9 13.2V3h2v10.2l3.6-3.6L16 11l-6 6Z",
  swap: "M6 3 2 7l4 4V8h9V6H6V3Zm8 6v3H5v2h9v3l4-4-4-4Z",
  user: "M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0H3Z",
  chevron: "m7 4 6 6-6 6-1.4-1.4 4.6-4.6-4.6-4.6L7 4Z",
  close: "m5.4 4 4.6 4.6L14.6 4 16 5.4 11.4 10l4.6 4.6-1.4 1.4-4.6-4.6L5.4 16 4 14.6 8.6 10 4 5.4 5.4 4Z",
  calendar: "M6 2h2v2h4V2h2v2h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V2ZM5 8v8h10V8H5Z",
  trend: "M2 14.6 7.5 9l3.5 3.5L15.6 8H13V6h6v6h-2V9.4l-6 6-3.5-3.5L3.4 16 2 14.6Z",
  bars: "M3 17h14v2H3v-2Zm1-6h3v5H4v-5Zm5-6h3v11H9V5Zm5 3h3v8h-3V8Z",
  checklist: "M2 4.5 3.4 3 5 4.6 8 1.6 9.4 3 5 7.4 2 4.5ZM11 4h7v2h-7V4Zm-9 7.5L3.4 10 5 11.6 8 8.6 9.4 10 5 14.4l-3-2.9ZM11 11h7v2h-7v-2Zm-8 5h4v2H3v-2Zm8 0h7v2h-7v-2Z",
  minus: "M4 9h12v2H4V9Z",
  cash: "M1 5h18v10H1V5Zm2 2v6h14V7H3Zm5 1h4v4H8V8Z",
};

export type IconName = keyof typeof paths;

export function Icon({ name, className = "size-4" }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`${className} shrink-0 fill-current`}>
      <path d={paths[name]} />
    </svg>
  );
}

const statusStyle: Record<string, { icon: IconName; className: string }> = {
  CONFIRMED: { icon: "check", className: "bg-confirmed-bg text-confirmed-fg" },
  CALCULATED_AFTER_CONFIRMATION: { icon: "calculator", className: "bg-calculated-bg text-calculated-fg" },
  OPEN_WEEK: { icon: "clock", className: "bg-calculated-bg text-calculated-fg" },
  NEEDS_REVIEW: { icon: "warning", className: "bg-review-bg text-review-fg" },
  DISCREPANCY: { icon: "alert", className: "bg-danger-bg text-danger-fg" },
};

/** Exactly one primary balance badge; meaning never relies on color alone. */
export function StatusBadge({ status }: { status: string }) {
  const style = statusStyle[status] ?? statusStyle.CONFIRMED;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium ${style.className}`}>
      <Icon name={style.icon} className="size-3.5" />
      {balanceStatusLabel[status] ?? status}
    </span>
  );
}

export type Tone = "neutral" | "info" | "review" | "danger" | "success" | "outflow";

const toneClass: Record<Tone, string> = {
  neutral: "bg-confirmed-bg text-confirmed-fg",
  info: "bg-calculated-bg text-calculated-fg",
  review: "bg-review-bg text-review-fg",
  danger: "bg-danger-bg text-danger-fg",
  success: "bg-success-bg text-success-fg",
  outflow: "bg-outflow-bg text-outflow-fg",
};

const toneIcon: Record<Tone, IconName> = { neutral: "check", info: "clock", review: "warning", danger: "alert", success: "check", outflow: "arrowDown" };

export function Tag({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: IconName }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium ${toneClass[tone]}`}>
      <Icon name={icon ?? toneIcon[tone]} className="size-3.5" />
      {children}
    </span>
  );
}

export function Alert({ tone, title, children, live }: { tone: Tone; title?: string; children?: ReactNode; live?: boolean }) {
  return (
    <div role={tone === "danger" ? "alert" : live ? "status" : undefined} className={`flex gap-2 px-3 py-2 text-sm ${toneClass[tone]}`}>
      <Icon name={toneIcon[tone]} className="mt-0.5 size-4" />
      <div>
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
      </div>
    </div>
  );
}

/** Signed amount with tabular digits; negative values keep the leading minus. */
export function Money({ value, className = "", signed = false }: { value: string | null | undefined; className?: string; signed?: boolean }) {
  const negative = isNegative(value);
  const text = money(value);
  return <span className={`tabular whitespace-nowrap ${className}`}>{signed && value && !negative && value !== "0" ? `+${text}` : text}</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`border border-border bg-surface p-4 md:p-5 ${className}`}>{children}</section>;
}

export function PageHeader({ title, description, action, leading }: { title: string; description?: string; action?: ReactNode; leading?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        {leading}
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
      </div>
      {action}
    </header>
  );
}

export function SectionTitle({ children, action, icon }: { children: ReactNode; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        {icon ? <Icon name={icon} className="size-4.5 text-primary" /> : null}
        {children}
      </h2>
      {action}
    </div>
  );
}

/** A labelled bar; the caller always shows the numbers as text too (PRD v0.20 P2). */
export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 bg-surface-subtle">
      <div className="fill-in h-1.5 bg-primary transition-[width] duration-200 ease-out" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** One segment per item, for counts such as resolved obligations. */
export function SegmentBar({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1.5 flex-1 ${i < done ? "fill-in bg-primary" : "bg-surface-subtle"}`} style={i < done ? { animationDelay: `${250 + i * 40}ms` } : undefined} />
      ))}
    </div>
  );
}

const monoClass: Record<1 | 2 | 3 | 4, string> = {
  1: "bg-mono-1/15 text-mono-1",
  2: "bg-mono-2/15 text-mono-2",
  3: "bg-mono-3/15 text-mono-3",
  4: "bg-mono-4/15 text-mono-4",
};

/** Account monogram; color comes from account order, never from the provider brand. */
export function Monogram({ letter, tone }: { letter: string; tone: 1 | 2 | 3 | 4 }) {
  return (
    <span aria-hidden="true" className={`flex size-10 shrink-0 items-center justify-center text-base font-semibold ${monoClass[tone]}`}>
      {letter}
    </span>
  );
}

export function Row({ label, children, emphasis }: { label: ReactNode; children: ReactNode; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-right ${emphasis ? "font-semibold" : ""}`}>{children}</dd>
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="border border-dashed border-control px-4 py-6 text-center">
      {icon ? <Icon name={icon} className="mx-auto mb-2 size-6 text-primary" /> : null}
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export const buttonClass = {
  primary:
    "inline-flex h-11 items-center justify-center gap-2 bg-primary px-4 font-medium text-primary-content transition-colors duration-150 hover:bg-primary-hover active:bg-primary-pressed disabled:cursor-not-allowed disabled:opacity-60",
  secondary:
    "inline-flex h-11 items-center justify-center gap-2 border border-control bg-surface px-4 font-medium transition-colors duration-150 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-60",
  danger:
    "inline-flex h-11 items-center justify-center gap-2 border border-danger-fg px-4 font-medium text-danger-fg transition-colors duration-150 hover:bg-danger-bg disabled:opacity-60",
  link: "inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline",
};

export function LinkButton({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: keyof typeof buttonClass }) {
  return (
    <Link href={href} className={buttonClass[variant]}>
      {children}
    </Link>
  );
}
