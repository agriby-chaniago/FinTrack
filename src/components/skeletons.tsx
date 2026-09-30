// Loading skeletons shown instantly on navigation (loading.tsx) while the
// server streams the page. `Skeleton` follows shadcn/ui's primitive — a pulsing
// block — styled with the Quiet Ledger tokens so it matches both themes.
import type { ComponentProps } from "react";

import { PageHeader } from "./ui";

export function Skeleton({ className = "", ...props }: ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden="true" className={`animate-pulse rounded-md bg-border ${className}`} {...props} />;
}

/** Announces loading once to assistive technology; the blocks themselves are hidden. */
function Loading({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Memuat…</span>
      {children}
    </div>
  );
}

function CardBlock({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-4 md:p-5 ${className}`}>
      <Skeleton className="h-4 w-1/3" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: lines }, (_, index) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3.5 w-1/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ListBlock({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-surface">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
          <div className="w-3/5 space-y-2">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

function FieldBlock() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3.5 w-28" />
      <Skeleton className="h-11 w-full rounded-lg" />
    </div>
  );
}

export function BerandaSkeleton() {
  return (
    <Loading>
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <ListBlock rows={3} />
      <div className="grid gap-3 md:grid-cols-3">
        <CardBlock lines={2} />
        <CardBlock lines={2} />
        <CardBlock lines={2} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <CardBlock />
        <CardBlock />
      </div>
    </Loading>
  );
}

export function CardsSkeleton({ title, description, cards = 3 }: { title: string; description?: string; cards?: number }) {
  return (
    <Loading>
      <PageHeader title={title} description={description} />
      {Array.from({ length: cards }, (_, index) => (
        <CardBlock key={index} />
      ))}
    </Loading>
  );
}

export function ListSkeleton({ title, description }: { title: string; description?: string }) {
  return (
    <Loading>
      <PageHeader title={title} description={description} />
      <ListBlock />
    </Loading>
  );
}

export function FormSkeleton({ title, fields = 4 }: { title?: string; fields?: number }) {
  return (
    <Loading>
      {title ? <PageHeader title={title} /> : <Skeleton className="h-7 w-48" />}
      <div className="max-w-xl space-y-4">
        {Array.from({ length: fields }, (_, index) => (
          <FieldBlock key={index} />
        ))}
        <Skeleton className="h-11 w-40 rounded-lg" />
      </div>
    </Loading>
  );
}

export function DetailSkeleton() {
  return (
    <Loading>
      <div className="flex items-end justify-between gap-3">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-11 w-24 rounded-lg" />
      </div>
      <CardBlock lines={4} />
      <CardBlock lines={3} />
    </Loading>
  );
}
