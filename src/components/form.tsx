"use client";

import { useId, type ReactNode } from "react";

import { Alert, buttonClass } from "./ui";

const controlClass =
  "mt-1 block h-11 w-full border border-control bg-surface px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export function TextField(props: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; hint?: string; maxLength?: number }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      <input id={id} value={props.value} maxLength={props.maxLength} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} className={controlClass} />
      {props.hint ? <p className="mt-1 text-sm text-muted">{props.hint}</p> : null}
    </div>
  );
}

export function DateField(props: { label: string; value: string; onChange: (value: string) => void; max?: string; min?: string; hint?: string; type?: "date" | "datetime-local" | "month" }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      <input
        id={id}
        type={props.type ?? "date"}
        value={props.value}
        max={props.max}
        min={props.min}
        aria-describedby={props.hint ? `${id}-hint` : undefined}
        onChange={(e) => props.onChange(e.target.value)}
        className={controlClass}
      />
      {props.hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

export function NumberField(props: { label: string; value: number | null; onChange: (value: number | null) => void; min?: number; max?: number; hint?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={props.min}
        max={props.max}
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.target.value ? Number(e.target.value) : null)}
        className={`${controlClass} tabular`}
      />
      {props.hint ? <p className="mt-1 text-sm text-muted">{props.hint}</p> : null}
    </div>
  );
}

export function SelectField(props: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value)} className={controlClass}>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TextArea(props: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={500}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="mt-1 block w-full border border-control bg-surface px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      {props.hint ? <p className="mt-1 text-sm text-muted">{props.hint}</p> : null}
    </div>
  );
}

export function Checkbox(props: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: string }) {
  return (
    <label className="flex min-h-11 items-start gap-3 py-1">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} className="checkbox checkbox-primary mt-0.5" />
      <span>
        <span className="text-sm font-medium">{props.label}</span>
        {props.hint ? <span className="block text-sm text-muted">{props.hint}</span> : null}
      </span>
    </label>
  );
}

export function FormErrors({ errors }: { errors: string[] | null }) {
  return <div aria-live="polite">{errors && errors.length > 0 ? <Alert tone="danger" title="Belum tersimpan">{errors.join(" ")}</Alert> : null}</div>;
}

/**
 * The cutover-day question (PRD v0.18): "Ya" skips recording because the
 * event is already in the opening balance; "Tidak" records it after cutover.
 */
export function CutoverDayQuestion({ onAnswer, pending }: { onAnswer: (answer: "ALREADY_IN_OPENING" | "NOT_IN_OPENING") => void; pending: boolean }) {
  return (
    <div role="alertdialog" aria-labelledby="cutover-question" className="border border-border bg-review-bg p-4 text-review-fg">
      <p id="cutover-question" className="font-medium">
        Sudah termasuk saldo awal?
      </p>
      <p className="mt-1 text-sm">Tanggal ini sama dengan hari mulai FinTrack. Jika kejadian ini sudah tercermin di saldo awal, FinTrack tidak akan mencatatnya lagi.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={pending} className={buttonClass.secondary} onClick={() => onAnswer("ALREADY_IN_OPENING")}>
          Ya, sudah termasuk
        </button>
        <button type="button" disabled={pending} className={buttonClass.primary} onClick={() => onAnswer("NOT_IN_OPENING")}>
          Belum, catat sekarang
        </button>
      </div>
    </div>
  );
}

/** Mobile-safe submit bar: sticky, above bottom navigation and the safe area. */
export function SubmitBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 mt-6 border-t border-border bg-surface px-4 py-3 md:static md:mx-0 md:border-0 md:bg-transparent md:px-0">
      <div className="flex flex-wrap gap-3">{children}</div>
    </div>
  );
}

export function SubmitButton({ pending, children, disabled }: { pending: boolean; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="submit" disabled={pending || disabled} aria-disabled={pending || disabled} className={`${buttonClass.primary} flex-1 md:flex-none`}>
      {pending ? "Menyimpan…" : children}
    </button>
  );
}
