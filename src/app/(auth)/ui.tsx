import type { ReactNode } from "react";

import { Brand } from "@/components/brand";

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm border border-border bg-surface p-6">
        <Brand className="text-sm text-muted" markClassName="size-5" />
        <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export function Field({
  label,
  name,
  type,
  autoComplete,
}: {
  label: string;
  name: string;
  type: "email" | "password";
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        className="mt-1 block h-11 w-full border border-control bg-surface px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      />
    </label>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="h-12 w-full bg-primary font-medium text-primary-content transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
    >
      {pending ? "Memproses…" : children}
    </button>
  );
}

export function FormStatus({ error, message }: { error?: string; message?: string }) {
  return (
    <div aria-live="polite" className="min-h-6">
      {error ? (
        <p role="alert" className="bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      {message ? <p className="bg-success-bg px-3 py-2 text-sm text-success-fg">{message}</p> : null}
    </div>
  );
}
