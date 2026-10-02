"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AmountInput } from "@/components/amount-input";
import { Checkbox, DateField, FormErrors, NumberField, SelectField, TextField } from "@/components/form";
import { Swap } from "@/components/motion";
import { buttonClass, Money, Tag } from "@/components/ui";
import { useMutation } from "@/lib/api-client";
import { formatCycle, formatDate } from "@/lib/format";
import { applyTheme, type ThemePreference } from "@/lib/theme";

function Saved({ show }: { show: boolean }) {
  return <div aria-live="polite">{show ? <p className="text-sm text-success-fg">Tersimpan.</p> : null}</div>;
}

export function ThemeSetting({ initial }: { initial: ThemePreference }) {
  const [theme, setTheme] = useState(initial);
  const options: { value: ThemePreference; label: string }[] = [
    { value: "system", label: "Ikuti sistem" },
    { value: "light", label: "Terang" },
    { value: "dark", label: "Gelap" },
  ];
  return (
    <fieldset>
      <legend className="sr-only">Tema</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="flex min-h-11 items-center gap-2 border border-control px-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
            <input
              type="radio"
              name="theme"
              className="radio radio-primary radio-sm"
              checked={theme === option.value}
              onChange={() => {
                setTheme(option.value);
                applyTheme(option.value);
              }}
            />
            <span className="text-sm">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type DailyView = {
  ruleId: string;
  amount: string;
  currentState: string;
  upcomingTransition: { id: string; toState: string; effectiveDate: string } | null;
  minimumTransitionDate: string;
  defaultTransitionDate: string;
};

export function DailyIncomeSetting({ daily }: { daily: DailyView }) {
  const [date, setDate] = useState(daily.defaultTransitionDate);
  const schedule = useMutation<Record<string, unknown>>(`/api/v1/daily-income/${daily.ruleId}/transitions`);
  const cancel = useMutation<undefined>(`/api/v1/daily-income/${daily.ruleId}/transitions/${daily.upcomingTransition?.id ?? ""}`, "DELETE");
  const toState = daily.currentState === "PAUSED" ? "ACTIVE" : "PAUSED";

  return (
    <div className="space-y-4">
      <p className="text-sm">
        <Money value={daily.amount} /> per hari ·{" "}
        <Tag tone={daily.currentState === "ACTIVE" ? "success" : "neutral"}>{daily.currentState === "ACTIVE" ? "Aktif" : daily.currentState === "PAUSED" ? "Dijeda" : "Belum mulai"}</Tag>
      </p>
      {daily.upcomingTransition ? (
        <div className="flex flex-wrap items-center gap-3 bg-surface-subtle p-3 text-sm">
          <span>
            {daily.upcomingTransition.toState === "PAUSED" ? "Dijeda" : "Aktif kembali"} mulai {formatDate(daily.upcomingTransition.effectiveDate)}
          </span>
          <button
            type="button"
            className={buttonClass.link}
            disabled={cancel.pending}
            onClick={async () => {
              await cancel.submit(undefined);
            }}
          >
            Batalkan jadwal
          </button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            await schedule.submit({ toState, effectiveDate: date });
          }}
        >
          <DateField label={toState === "PAUSED" ? "Jeda mulai tanggal" : "Aktif kembali mulai tanggal"} value={date} min={daily.minimumTransitionDate} onChange={setDate} />
          <button type="submit" className={buttonClass.secondary} disabled={schedule.pending}>
            {toState === "PAUSED" ? "Jeda income harian" : "Aktifkan kembali"}
          </button>
        </form>
      )}
      <FormErrors errors={schedule.error ?? cancel.error} />
    </div>
  );
}

function nextCycle(current: string): string {
  const [year, month] = current.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * Sets the last month a rule expects anything. The last month cannot be in the past,
 * so ending in the current month keeps this month's expectation; `noEvent` names the
 * Rutinitas action that resolves it when nothing happens.
 */
export function EndRuleForm({ path, currentCycle, label, noEvent }: { path: string; currentCycle: string; label: string; noEvent: string }) {
  const [open, setOpen] = useState(false);
  const [lastCycle, setLastCycle] = useState(currentCycle);
  const end = useMutation<{ lastCycle: string }>(path, "PATCH");
  return (
    <Swap swapKey={open ? "form" : "button"}>
      {open ? (
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await end.submit({ lastCycle });
            if (result.ok) {
              setOpen(false);
            }
          }}
        >
          <DateField type="month" label="Bulan terakhir" value={lastCycle} min={currentCycle} onChange={setLastCycle} />
          <p className="text-sm text-muted">Tidak ada perkiraan setelah {formatCycle(lastCycle)}. Riwayat tetap tersimpan.</p>
          {lastCycle === currentCycle ? (
            <p className="text-sm text-muted">
              Perkiraan {formatCycle(currentCycle)} tetap ada. Jika tidak terjadi, pilih {noEvent} di Rutinitas.
            </p>
          ) : null}
          <FormErrors errors={end.error} />
          <div className="flex gap-2">
            <button type="submit" className={buttonClass.danger} disabled={end.pending}>
              Akhiri
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setOpen(false)}>
              Batal
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={buttonClass.link} onClick={() => setOpen(true)}>
          {label}
        </button>
      )}
    </Swap>
  );
}

export function RevisionForm(props: { ruleId: string; currentCycle: string; expectedDay: number | null; expectedAmount: string | null; subscription: boolean }) {
  const [open, setOpen] = useState(false);
  const [cycle, setCycle] = useState(nextCycle(props.currentCycle));
  const [day, setDay] = useState<number | null>(props.expectedDay);
  const [amount, setAmount] = useState<string | null>(props.expectedAmount);
  const [saved, setSaved] = useState(false);
  const revise = useMutation<Record<string, unknown>>(`/api/v1/recurring-expense-rules/${props.ruleId}/revisions`);
  return (
    <Swap swapKey={open ? "form" : "button"}>
      {open ? (
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await revise.submit({ effectiveFromCycle: cycle, expectedDay: day, expectedAmount: amount });
            setSaved(result.ok);
            if (result.ok) {
              setOpen(false);
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <DateField type="month" label="Berlaku mulai" value={cycle} min={nextCycle(props.currentCycle)} onChange={setCycle} />
            <NumberField label={props.subscription ? "Tanggal tagihan" : "Tanggal (opsional)"} value={day} min={1} max={31} onChange={setDay} />
            <AmountInput label={props.subscription ? "Nominal" : "Nominal (opsional)"} value={amount} onChange={setAmount} />
          </div>
          <FormErrors errors={revise.error} />
          <Saved show={saved} />
          <div className="flex gap-2">
            <button type="submit" className={buttonClass.primary} disabled={revise.pending}>
              Simpan perubahan
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setOpen(false)}>
              Batal
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={buttonClass.link} onClick={() => setOpen(true)}>
          Ubah perkiraan
        </button>
      )}
    </Swap>
  );
}

export function AddSubscriptionForm() {
  const [formKey, setFormKey] = useState(0);
  const [name, setName] = useState("");
  const [day, setDay] = useState<number | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [includeCurrent, setIncludeCurrent] = useState(false);
  const [saved, setSaved] = useState(false);
  const create = useMutation<Record<string, unknown>>("/api/v1/recurring-expense-rules");
  return (
    <form
      key={formKey}
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const issues: string[] = [];
        if (!name.trim()) issues.push("Isi nama langganan.");
        if (!day) issues.push("Isi tanggal tagihan.");
        if (!amount) issues.push("Isi nominal.");
        if (issues.length) {
          create.setError(issues);
          return;
        }
        const result = await create.submit({ name: name.trim(), expectedDay: day, expectedAmount: amount, includeCurrentCycle: includeCurrent });
        setSaved(result.ok);
        if (result.ok) {
          setName("");
          setDay(null);
          setAmount(null);
          setIncludeCurrent(false);
          setFormKey((key) => key + 1);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Nama langganan" value={name} maxLength={80} onChange={setName} />
        <NumberField label="Tanggal tagihan" value={day} min={1} max={31} onChange={setDay} />
        <AmountInput label="Nominal" value={amount} onChange={setAmount} />
      </div>
      <Checkbox label="Sudah berlaku bulan ini" hint="Jika tidak dicentang, perkiraan mulai bulan depan." checked={includeCurrent} onChange={setIncludeCurrent} />
      <FormErrors errors={create.error} />
      <Saved show={saved} />
      <button type="submit" className={buttonClass.secondary} disabled={create.pending}>
        Tambah langganan
      </button>
    </form>
  );
}

export function FloorSetting({ accountId, accountName, floor }: { accountId: string; accountName: string; floor: string }) {
  const [amount, setAmount] = useState<string | null>(floor);
  const [saved, setSaved] = useState(false);
  const save = useMutation<Record<string, unknown>>("/api/v1/settings", "PATCH");
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (amount === null) {
          save.setError(["Isi saldo minimum."]);
          return;
        }
        const result = await save.submit({ retainedFloor: { accountId, amount } });
        setSaved(result.ok);
      }}
    >
      <AmountInput label={`Saldo minimum ditahan di ${accountName}`} hint="Berlaku untuk target transfer berikutnya; target yang sudah ada tidak berubah." value={amount} onChange={setAmount} />
      <FormErrors errors={save.error} />
      <Saved show={saved} />
      <button type="submit" className={buttonClass.secondary} disabled={save.pending}>
        Simpan
      </button>
    </form>
  );
}

export function DefaultSourceSetting({ accounts, current }: { accounts: { id: string; name: string }[]; current: string | null }) {
  const [value, setValue] = useState(current ?? accounts[0]?.id ?? "");
  const [saved, setSaved] = useState(false);
  const save = useMutation<Record<string, unknown>>("/api/v1/settings", "PATCH");
  return (
    <div className="space-y-2">
      <SelectField
        label="Sumber default pengeluaran khusus"
        value={value}
        onChange={async (next) => {
          setValue(next);
          const result = await save.submit({ defaultSpecialSourceAccountId: next });
          setSaved(result.ok);
        }}
        options={accounts.map((a) => ({ value: a.id, label: a.name }))}
      />
      <FormErrors errors={save.error} />
      <Saved show={saved} />
    </div>
  );
}

export function CategoryRow({ id, name, archived }: { id: string; name: string; archived: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const update = useMutation<Record<string, unknown>>(`/api/v1/categories/${id}`, "PATCH");

  async function patch(body: Record<string, unknown>) {
    const result = await update.submit(body);
    if (result.ok) {
      setEditing(false);
    }
  }

  return (
    <li className="py-2">
      <Swap swapKey={editing ? "edit" : "view"}>
        {editing ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              await patch({ displayName: value });
            }}
          >
            <TextField label="Nama kategori" value={value} maxLength={60} onChange={setValue} />
            <button type="submit" className={buttonClass.primary} disabled={update.pending}>
              Simpan
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setEditing(false)}>
              Batal
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={archived ? "text-muted" : ""}>
              {name} {archived ? <Tag tone="neutral">Diarsipkan</Tag> : null}
            </span>
            <span className="flex gap-3">
              <button type="button" className={buttonClass.link} onClick={() => setEditing(true)}>
                Ganti nama
              </button>
              <button type="button" className={buttonClass.link} disabled={update.pending} onClick={() => patch({ isArchived: !archived })}>
                {archived ? "Aktifkan" : "Arsipkan"}
              </button>
            </span>
          </div>
        )}
      </Swap>
      <FormErrors errors={update.error} />
    </li>
  );
}

export function LogoutButtons() {
  const router = useRouter();
  const [pending, setPending] = useState<"local" | "global" | null>(null);
  async function logout(scope: "local" | "global") {
    setPending(scope);
    await fetch("/api/v1/session/logout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope }), credentials: "same-origin" });
    router.replace("/login");
    router.refresh();
  }
  return (
    <div className="flex flex-wrap gap-3">
      <button type="button" className={buttonClass.secondary} disabled={pending !== null} onClick={() => logout("local")}>
        {pending === "local" ? "Keluar…" : "Keluar dari perangkat ini"}
      </button>
      <button type="button" className={buttonClass.danger} disabled={pending !== null} onClick={() => logout("global")}>
        {pending === "global" ? "Keluar…" : "Keluar dari semua perangkat"}
      </button>
    </div>
  );
}
