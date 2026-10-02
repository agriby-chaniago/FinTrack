import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { InstallApp } from "@/components/install-app";
import { Card, Money, PageHeader, SectionTitle, Tag } from "@/components/ui";
import { businessDateOf, cycleKeyOf } from "@/lib/business-time";
import { formatCycle } from "@/lib/format";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { dailyIncomeView } from "@/server/application/daily-income";
import { listCategories } from "@/server/application/events";
import { listRecurringRules } from "@/server/application/monthly";
import { recordingContext } from "@/server/application/recording-context";
import { getSettings } from "@/server/application/settings";
import { runAsPageOwner } from "@/server/auth/page-owner";

import {
  AddSubscriptionForm,
  CategoryRow,
  DailyIncomeSetting,
  DefaultSourceSetting,
  EndRuleForm,
  FloorSetting,
  LogoutButtons,
  RevisionForm,
  ThemeSetting,
} from "./sections";

const ruleStatus: Record<string, string> = { ACTIVE: "Aktif", SCHEDULED: "Terjadwal", ENDED: "Berakhir" };

export default async function PengaturanPage() {
  const now = new Date();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const result = await runAsPageOwner(async (tx, { ownerId }) => {
    const settings = await getSettings(tx, ownerId);
    const daily = await dailyIncomeView(tx, ownerId, now);
    const rules = await listRecurringRules(tx, ownerId, now);
    const categories = await listCategories(tx, ownerId, { includeArchived: true });
    const context = await recordingContext(tx, ownerId);
    return { settings, daily, rules, categories, context };
  });
  if (result.status !== "OWNER") redirect("/login");
  const { settings, daily, rules, categories, context } = result.value;
  const currentCycle = cycleKeyOf(businessDateOf(now));

  return (
    <div className="stagger space-y-5">
      <PageHeader title="Pengaturan" />

      <Card>
        <SectionTitle>Tampilan</SectionTitle>
        <ThemeSetting initial={theme} />
      </Card>

      {daily ? (
        <Card>
          <SectionTitle>Income harian</SectionTitle>
          <DailyIncomeSetting daily={daily} />
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Income bulanan</SectionTitle>
        <ul className="divide-y divide-border">
          {rules.monthlyIncome.map((rule) => (
            <li key={rule.id} className="space-y-2 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  Perkiraan <Money value={rule.expectedAmount} /> · mulai {formatCycle(rule.firstExpectedCycle)}
                  {rule.lastExpectedCycle ? ` · sampai ${formatCycle(rule.lastExpectedCycle)}` : ""}
                </span>
                <Tag tone={rule.status === "ACTIVE" ? "success" : "neutral"}>{ruleStatus[rule.status]}</Tag>
              </div>
              {rule.status !== "ENDED" ? <EndRuleForm path={`/api/v1/monthly-income-rules/${rule.id}`} currentCycle={currentCycle} label="Akhiri income bulanan" /> : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionTitle>Kewajiban bulanan</SectionTitle>
        <ul className="divide-y divide-border">
          {rules.recurringExpenses.map((rule) => (
            <li key={rule.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{rule.name}</p>
                  <p className="text-sm text-muted">
                    {rule.expectedDay ? `Tanggal ${rule.expectedDay}` : "Tanggal belum pasti"}
                    {rule.expectedAmount ? (
                      <>
                        {" "}
                        · <Money value={rule.expectedAmount} />
                      </>
                    ) : null}
                    {rule.lastCycle ? ` · sampai ${formatCycle(rule.lastCycle)}` : ""}
                  </p>
                  {rule.upcomingRevisions.map((revision) => (
                    <p key={revision.effectiveFromCycle} className="text-sm text-calculated-fg">
                      Mulai {formatCycle(revision.effectiveFromCycle)}: {revision.expectedDay ? `tanggal ${revision.expectedDay}` : "tanggal belum pasti"}
                      {revision.expectedAmount ? (
                        <>
                          {" "}
                          · <Money value={revision.expectedAmount} />
                        </>
                      ) : null}
                    </p>
                  ))}
                </div>
                <Tag tone={rule.status === "ACTIVE" ? "success" : "neutral"}>{ruleStatus[rule.status]}</Tag>
              </div>
              {rule.status !== "ENDED" ? (
                <div className="flex flex-wrap gap-4">
                  <RevisionForm ruleId={rule.id} currentCycle={currentCycle} expectedDay={rule.expectedDay} expectedAmount={rule.expectedAmount} subscription={rule.kind === "SUBSCRIPTION"} />
                  <EndRuleForm path={`/api/v1/recurring-expense-rules/${rule.id}`} currentCycle={currentCycle} label="Akhiri" />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <details className="mt-3 border-t border-border pt-3">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">Tambah langganan</summary>
          <AddSubscriptionForm />
        </details>
      </Card>

      {settings.retainedFloors.length > 0 ? (
        <Card>
          <SectionTitle>Saldo minimum ditahan</SectionTitle>
          <div className="space-y-4">
            {settings.retainedFloors.map((floor) => (
              <FloorSetting key={floor.accountId} accountId={floor.accountId} accountName={floor.accountName} floor={floor.retainedBalanceFloor} />
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Pengeluaran khusus</SectionTitle>
        <DefaultSourceSetting accounts={context.accounts.map((a) => ({ id: a.id, name: a.name }))} current={settings.defaultSpecialSourceAccountId} />
        <h3 className="mt-5 text-sm font-medium">Kategori</h3>
        {categories.length === 0 ? (
          <p className="text-sm text-muted">Belum ada kategori.</p>
        ) : (
          <ul className="divide-y divide-border">
            {categories.map((category) => (
              <CategoryRow key={category.id} id={category.id} name={category.displayName} archived={category.isArchived} />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle>Data</SectionTitle>
        <p className="mb-3 text-sm text-muted">Unduh seluruh data dalam format JSON dan CSV untuk arsip pribadi.</p>
        <a href="/api/v1/export" className="inline-flex h-11 items-center border border-control px-4 font-medium hover:bg-surface-subtle" download>
          Ekspor data
        </a>
      </Card>

      <Card>
        <SectionTitle>Pasang aplikasi</SectionTitle>
        <InstallApp />
      </Card>

      <Card>
        <SectionTitle>Sesi</SectionTitle>
        <LogoutButtons />
      </Card>
    </div>
  );
}
