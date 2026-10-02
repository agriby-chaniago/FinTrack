"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { AmountInput } from "@/components/amount-input";
import { StepTransition } from "@/components/motion";
import { formatIdr, parseIdrDecimal } from "@/lib/money";
import type { OnboardingDraft, OnboardingIssueCode } from "@/server/domain/onboarding";

type Review = {
  accounts: { key: string; physical: string | null; external: string; personal: string | null; shortfall: string | null }[];
  totals: { physical: string; external: string; personal: string; shortfall: string } | null;
  boundaries: {
    cutoverDate: string;
    dailyIncomeStartDate: string;
    monthlyIncomeFirstCycle: string;
    subscriptionFirstCycles: string[];
    bankFeeFirstCycle: string;
  } | null;
};

export type OnboardingFlowProps = { initialDraft: OnboardingDraft; initialVersion: number; initialReview: Review };

const steps = ["Waktu mulai", "Saldo akun", "Dana titipan", "Rutinitas awal", "Tinjau"] as const;

const issueMessages: Record<OnboardingIssueCode, string> = {
  REQUIRED: "Wajib diisi.",
  MUST_BE_POSITIVE: "Harus lebih dari Rp0.",
  MUST_NOT_BE_NEGATIVE: "Tidak boleh negatif.",
  CUTOVER_IN_FUTURE: "Waktu mulai tidak boleh di masa depan.",
  DUPLICATE_NAME: "Nama ini sudah dipakai.",
};

function stepOfPath(path: string): number {
  if (path.startsWith("cutoverAt")) return 0;
  if (path.startsWith("accounts")) return 1;
  if (path.startsWith("externals")) return 2;
  return 3;
}

const jakartaParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function toJakartaInput(iso: string | null): string {
  if (!iso) return "";
  const parts = Object.fromEntries(jakartaParts.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const formatCycle = (cycle: string) => `${monthNames[Number(cycle.slice(5, 7)) - 1]} ${cycle.slice(0, 4)}`;
const formatDate = (date: string) => `${Number(date.slice(8, 10))} ${formatCycle(date.slice(0, 7))}`;
const money = (value: string | null) => (value === null ? "—" : formatIdr(parseIdrDecimal(value)));

function AlertIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 fill-current">
      <path d="M10 2 1 18h18L10 2Zm-.9 6h1.8v5H9.1V8Zm0 6.5h1.8v1.8H9.1v-1.8Z" />
    </svg>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function TextField(props: { label: string; value: string; onChange: (value: string) => void; error?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{props.label}</span>
      <input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        aria-invalid={props.error ? true : undefined}
        className="mt-1 block h-11 w-full border border-control bg-surface px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      />
      {props.error ? <span className="mt-1 block text-sm text-danger-fg">{props.error}</span> : null}
    </label>
  );
}

function Checkbox(props: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: string }) {
  return (
    <label className="flex min-h-11 items-start gap-3 py-1">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
        className="mt-1 size-5 accent-[var(--primary)]"
      />
      <span>
        <span className="text-sm font-medium">{props.label}</span>
        {props.hint ? <span className="block text-sm text-muted">{props.hint}</span> : null}
      </span>
    </label>
  );
}

const secondaryButton =
  "h-11 border border-control px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const primaryButton =
  "h-12 flex-1 bg-primary px-4 font-medium text-primary-content transition-colors duration-150 hover:bg-primary-hover disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function OnboardingFlow({ initialDraft, initialVersion, initialReview }: OnboardingFlowProps) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [version, setVersion] = useState(initialVersion);
  const [review, setReview] = useState(initialReview);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<string>();
  const [issues, setIssues] = useState<Record<string, OnboardingIssueCode>>({});
  const [hasExternal, setHasExternal] = useState(initialDraft.externals.length > 0);

  /** Moves to a step; the step transition slides forward or back accordingly. */
  function goTo(next: number) {
    setDirection(next >= step ? 1 : -1);
    setStep(next);
  }

  const update = (change: (next: OnboardingDraft) => void) => {
    setDraft((current) => {
      const next = structuredClone(current);
      change(next);
      return next;
    });
  };
  const issue = (path: string) => (issues[path] ? issueMessages[issues[path]] : undefined);

  async function saveAndGo(target: number) {
    setPending(true);
    setBanner(undefined);
    try {
      const body = hasExternal ? draft : { ...draft, externals: [] };
      const response = await fetch("/api/v1/onboarding/draft", {
        method: "PUT",
        headers: { "content-type": "application/json", "if-match": `"${version}"` },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok) {
        setBanner(
          json.error?.code === "STALE_VERSION"
            ? "Draft diubah di perangkat lain. Muat ulang halaman sebelum melanjutkan."
            : "Draft belum tersimpan. Periksa isian lalu coba lagi.",
        );
        return;
      }
      setVersion(json.data.version);
      setReview(json.data.review);
      goTo(target);
    } catch {
      setBanner("Belum tersimpan. Periksa koneksi lalu coba lagi.");
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    setPending(true);
    setBanner(undefined);
    try {
      const response = await fetch("/api/v1/onboarding/confirm", { method: "POST", headers: { "if-match": `"${version}"` } });
      const json = await response.json();
      if (response.status === 201) {
        router.replace("/");
        router.refresh();
        return;
      }
      if (json.error?.code === "VALIDATION_FAILED" && Array.isArray(json.error.details?.issues)) {
        const found = Object.fromEntries(
          (json.error.details.issues as { path: string; code: OnboardingIssueCode }[]).map((item) => [item.path, item.code]),
        );
        setIssues(found);
        goTo(Math.min(...Object.keys(found).map(stepOfPath)));
        setBanner("Masih ada isian yang perlu dilengkapi.");
        return;
      }
      setBanner(
        json.error?.code === "STALE_VERSION"
          ? "Draft diubah di perangkat lain. Muat ulang halaman."
          : "FinTrack belum dimulai. Coba lagi.",
      );
    } catch {
      setBanner("Belum tersimpan. Periksa koneksi lalu coba lagi.");
    } finally {
      setPending(false);
    }
  }

  const accountName = (key: string) => draft.accounts.find((account) => account.key === key)?.displayName ?? key;
  const { routines } = draft;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-32 pt-8 md:px-8">
      <p className="text-sm text-muted">
        Langkah {step + 1} dari {steps.length} · {steps[step]}
      </p>
      <h1 className="mt-1 text-2xl font-semibold">Mulai FinTrack</h1>

      <div aria-live="polite" className="mt-4">
        {banner ? (
          <p role="alert" className="flex gap-2 bg-danger-bg px-3 py-2 text-sm text-danger-fg">
            <AlertIcon />
            {banner}
          </p>
        ) : null}
      </div>

      <div data-step-area className="relative mt-6">
        <StepTransition step={step} direction={direction}>
          {step === 0 ? (
            <Section
              title="Waktu mulai (cutover)"
              description="Semua kejadian sampai waktu ini dianggap sudah termasuk saldo awal. Waktu memakai zona Asia/Jakarta."
            >
              <label className="block">
                <span className="text-sm font-medium">Tanggal dan jam</span>
                <input
                  type="datetime-local"
                  value={toJakartaInput(draft.cutoverAt)}
                  onChange={(event) =>
                    update((next) => {
                      next.cutoverAt = event.target.value ? `${event.target.value}:00+07:00` : null;
                    })
                  }
                  className="mt-1 block h-11 w-full border border-control bg-surface px-3 text-base"
                />
                {issue("cutoverAt") ? <span className="mt-1 block text-sm text-danger-fg">{issue("cutoverAt")}</span> : null}
              </label>
            </Section>
          ) : null}

          {step === 1 ? (
            <Section
              title="Saldo di setiap akun"
              description="Masukkan saldo persis seperti yang terlihat di aplikasi bank atau e-wallet, termasuk sen jika ada."
            >
              {draft.accounts.map((account, index) => (
                <div key={account.key} className="space-y-3 border border-border bg-surface p-4">
                  <TextField
                    label={`Nama akun (${account.purposeLabel})`}
                    value={account.displayName}
                    onChange={(value) => update((next) => void (next.accounts[index].displayName = value))}
                  />
                  <AmountInput
                    label={`Saldo ${account.displayName}`}
                    value={account.physicalBalance}
                    onChange={(value) => update((next) => void (next.accounts[index].physicalBalance = value))}
                    error={issue(`accounts.${index}.physicalBalance`)}
                  />
                </div>
              ))}
            </Section>
          ) : null}

          {step === 2 ? (
            <Section title="Dana titipan" description="Uang milik orang lain yang sedang berada di akun Anda tidak dihitung sebagai uang pribadi.">
              <Checkbox label="Ada uang milik orang lain" checked={hasExternal} onChange={setHasExternal} />
              {hasExternal ? (
                <div className="space-y-4">
                  {draft.externals.map((external, index) => (
                    <div key={index} className="space-y-3 border border-border bg-surface p-4">
                      <TextField
                        label="Pemilik dana"
                        value={external.subjectName}
                        onChange={(value) => update((next) => void (next.externals[index].subjectName = value))}
                        error={issue(`externals.${index}.subjectName`)}
                      />
                      <label className="block">
                        <span className="text-sm font-medium">Berada di akun</span>
                        <select
                          value={external.accountKey}
                          onChange={(event) =>
                            update((next) => void (next.externals[index].accountKey = event.target.value as typeof external.accountKey))
                          }
                          className="mt-1 block h-11 w-full border border-control bg-surface px-3 text-base"
                        >
                          {draft.accounts.map((account) => (
                            <option key={account.key} value={account.key}>
                              {account.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <AmountInput
                        label="Jumlah"
                        value={external.amount}
                        onChange={(value) => update((next) => void (next.externals[index].amount = value))}
                        error={issue(`externals.${index}.amount`)}
                      />
                      <button
                        type="button"
                        className={secondaryButton}
                        onClick={() => update((next) => void next.externals.splice(index, 1))}
                      >
                        Hapus
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() =>
                      update((next) => void next.externals.push({ accountKey: "monthly", subjectName: "", amount: null }))
                    }
                  >
                    + Tambah pemilik dana
                  </button>
                </div>
              ) : null}
            </Section>
          ) : null}

          {step === 3 ? (
            <Section title="Rutinitas awal" description="Automation dimulai setelah waktu mulai, kecuali Anda memilih memasukkan periode berjalan.">
              <div className="space-y-3 border border-border bg-surface p-4">
                <h3 className="font-medium">Income harian {accountName("daily")}</h3>
                <AmountInput
                  label="Nominal per hari"
                  value={routines.dailyIncome.amount}
                  onChange={(value) => update((next) => void (next.routines.dailyIncome.amount = value))}
                  error={issue("routines.dailyIncome.amount")}
                />
                <Checkbox
                  label="Income hari ini belum termasuk — mulai hari ini"
                  checked={routines.dailyIncome.startOnCutoverDay}
                  onChange={(checked) => update((next) => void (next.routines.dailyIncome.startOnCutoverDay = checked))}
                />
              </div>

              <div className="space-y-3 border border-border bg-surface p-4">
                <h3 className="font-medium">Income bulanan {accountName("monthly")}</h3>
                <AmountInput
                  label="Perkiraan nominal per bulan"
                  value={routines.monthlyIncome.expectedAmount}
                  onChange={(value) => update((next) => void (next.routines.monthlyIncome.expectedAmount = value))}
                  error={issue("routines.monthlyIncome.expectedAmount")}
                />
                <Checkbox
                  label="Income bulan ini belum diterima — mulai bulan ini"
                  checked={routines.monthlyIncome.includeCurrentCycle}
                  onChange={(checked) => update((next) => void (next.routines.monthlyIncome.includeCurrentCycle = checked))}
                />
              </div>

              <div className="space-y-4 border border-border bg-surface p-4">
                <h3 className="font-medium">Subscription</h3>
                {routines.subscriptions.map((subscription, index) => (
                  <div key={index} className="space-y-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
                    <TextField
                      label="Nama subscription"
                      value={subscription.name}
                      onChange={(value) => update((next) => void (next.routines.subscriptions[index].name = value))}
                      error={issue(`routines.subscriptions.${index}.name`)}
                    />
                    <label className="block">
                      <span className="text-sm font-medium">Perkiraan tanggal tagihan</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={31}
                        value={subscription.expectedDay ?? ""}
                        onChange={(event) =>
                          update(
                            (next) =>
                              void (next.routines.subscriptions[index].expectedDay = event.target.value ? Number(event.target.value) : null),
                          )
                        }
                        className="mt-1 block h-11 w-full border border-control bg-surface px-3 text-base tabular-nums"
                      />
                      {issue(`routines.subscriptions.${index}.expectedDay`) ? (
                        <span className="mt-1 block text-sm text-danger-fg">{issue(`routines.subscriptions.${index}.expectedDay`)}</span>
                      ) : null}
                    </label>
                    <AmountInput
                      label="Perkiraan nominal"
                      value={subscription.expectedAmount}
                      onChange={(value) => update((next) => void (next.routines.subscriptions[index].expectedAmount = value))}
                      error={issue(`routines.subscriptions.${index}.expectedAmount`)}
                    />
                    <Checkbox
                      label="Belum ditagih bulan ini — mulai bulan ini"
                      checked={subscription.includeCurrentCycle}
                      onChange={(checked) => update((next) => void (next.routines.subscriptions[index].includeCurrentCycle = checked))}
                    />
                    <button
                      type="button"
                      className={secondaryButton}
                      onClick={() => update((next) => void next.routines.subscriptions.splice(index, 1))}
                    >
                      Hapus subscription
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() =>
                    update(
                      (next) =>
                        void next.routines.subscriptions.push({ name: "", expectedDay: 5, expectedAmount: null, includeCurrentCycle: false }),
                    )
                  }
                >
                  + Tambah subscription
                </button>
              </div>

              <div className="space-y-3 border border-border bg-surface p-4">
                <h3 className="font-medium">Biaya bulanan bank {accountName("monthly")}</h3>
                <p className="text-sm text-muted">Boleh dikosongkan jika belum diketahui; FinTrack tetap mengingatkan setiap bulan.</p>
                <label className="block">
                  <span className="text-sm font-medium">Perkiraan tanggal (opsional)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={31}
                    value={routines.bankFee.expectedDay ?? ""}
                    onChange={(event) =>
                      update((next) => void (next.routines.bankFee.expectedDay = event.target.value ? Number(event.target.value) : null))
                    }
                    className="mt-1 block h-11 w-full border border-control bg-surface px-3 text-base tabular-nums"
                  />
                </label>
                <AmountInput
                  label="Perkiraan nominal (opsional)"
                  value={routines.bankFee.expectedAmount}
                  onChange={(value) => update((next) => void (next.routines.bankFee.expectedAmount = value))}
                  error={issue("routines.bankFee.expectedAmount")}
                />
                <Checkbox
                  label="Belum dipotong bulan ini — mulai bulan ini"
                  checked={routines.bankFee.includeCurrentCycle}
                  onChange={(checked) => update((next) => void (next.routines.bankFee.includeCurrentCycle = checked))}
                />
              </div>

              <div className="space-y-3 border border-border bg-surface p-4">
                <h3 className="font-medium">Saldo minimum ditahan di {accountName("monthly")}</h3>
                <AmountInput
                  label="Saldo minimum ditahan"
                  hint="Wajib dipilih. Rp0 juga boleh. Nilai ini bukan pengeluaran."
                  value={routines.retainedFloor}
                  onChange={(value) => update((next) => void (next.routines.retainedFloor = value))}
                  error={issue("routines.retainedFloor")}
                />
              </div>
            </Section>
          ) : null}

          {step === 4 ? (
            <Section title="Tinjau sebelum mulai" description="Setelah dikonfirmasi, saldo awal hanya dapat dikoreksi melalui snapshot pengganti.">
              <div className="divide-y divide-border border border-border bg-surface">
                {review.accounts.map((row) => (
                  <div key={row.key} className="space-y-1 p-4">
                    <p className="font-medium">{accountName(row.key)}</p>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <dt className="text-muted">Saldo fisik</dt>
                      <dd className="text-right tabular-nums">{money(row.physical)}</dd>
                      <dt className="text-muted">Dana titipan</dt>
                      <dd className="text-right tabular-nums">{money(row.external)}</dd>
                      <dt className="text-muted">Uang pribadi</dt>
                      <dd className="text-right font-medium tabular-nums">{money(row.personal)}</dd>
                    </dl>
                    {row.shortfall !== null && row.shortfall !== "0" ? (
                      <p role="alert" className="flex gap-2 bg-danger-bg px-3 py-2 text-sm text-danger-fg">
                        <AlertIcon />
                        Kekurangan dana titipan {money(row.shortfall)}: dana titipan melebihi saldo fisik.
                      </p>
                    ) : null}
                  </div>
                ))}
                {review.totals ? (
                  <div className="flex items-baseline justify-between p-4">
                    <span className="font-medium">Total uang pribadi</span>
                    <span className="text-xl font-semibold tabular-nums">{money(review.totals.personal)}</span>
                  </div>
                ) : null}
              </div>

              {review.boundaries ? (
                <ul className="space-y-1 border border-border bg-surface p-4 text-sm">
                  <li>Waktu mulai: {formatDate(review.boundaries.cutoverDate)}</li>
                  <li>
                    Income harian {money(routines.dailyIncome.amount)} mulai {formatDate(review.boundaries.dailyIncomeStartDate)}
                  </li>
                  <li>Income bulanan mulai cycle {formatCycle(review.boundaries.monthlyIncomeFirstCycle)}</li>
                  {routines.subscriptions.map((subscription, index) => (
                    <li key={index}>
                      Subscription {subscription.name || "(tanpa nama)"} mulai cycle{" "}
                      {formatCycle(review.boundaries!.subscriptionFirstCycles[index])}
                    </li>
                  ))}
                  <li>Biaya bank mulai cycle {formatCycle(review.boundaries.bankFeeFirstCycle)}</li>
                  <li>Saldo minimum ditahan: {money(routines.retainedFloor)}</li>
                </ul>
              ) : null}
            </Section>
          ) : null}
        </StepTransition>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex w-full max-w-xl gap-3">
          {step > 0 ? (
            <button type="button" className={secondaryButton} disabled={pending} onClick={() => goTo(step - 1)}>
              Kembali
            </button>
          ) : null}
          {step < steps.length - 1 ? (
            <button type="button" className={primaryButton} disabled={pending} onClick={() => saveAndGo(step + 1)}>
              {pending ? "Menyimpan…" : "Simpan & lanjut"}
            </button>
          ) : (
            <button type="button" className={primaryButton} disabled={pending} onClick={confirm}>
              {pending ? "Memproses…" : "Mulai FinTrack"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
