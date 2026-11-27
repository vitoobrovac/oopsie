
"use client";

import Link from "next/link";
import { useState } from "react";
import { AboutOopsie } from "@/components/dashboard/about-oopsie";
import { BudgetNotices } from "@/components/dashboard/budget-notices";
import { useAccount } from "@/components/account/account-provider";
import { Toast } from "@/components/layout/toast";
import { AddTransactionButton } from "@/components/features/add-transaction";
import { localToday, useLedger } from "@/lib/use-ledger";
import { Icon, type IconName } from "@/components/layout/icon";
import { CashFlowChart } from "@/components/dashboard/cash-flow-chart";
import { CategoryChart } from "@/components/dashboard/finance-charts";
import { formatMinor, formatReceiptDate, monthLabel } from "@/lib/finance-format";
import type { SavingsPeriod } from "@/lib/goal-savings";
import type { OverviewPeriod } from "@/lib/ledger";

const cardStyles = {
  overall: { icon: "pie", surface: "border-[#dce6f2] bg-[#edf4fc] text-[#173752]", badge: "bg-[#dbe8f7] text-[#24486b]" },
  current: { icon: "cart", surface: "border-[#f1dfcc] bg-[#fff4e8] text-[#633919]", badge: "bg-[#fae4cc] text-[#754419]" },
  previous: { icon: "calendar", surface: "border-[#e6def1] bg-[#f5f0fa] text-[#4c3862]", badge: "bg-[#e9dff4] text-[#5d4480]" },
  income: { icon: "arrow-down", surface: "border-[#d4eadc] bg-[#eaf8ee] text-[#1d5137]", badge: "bg-[#d6efde] text-[#205837]" },
  balance: { icon: "wallet", surface: "border-[#183c31] bg-[#183c31] text-[#f6fff5]", badge: "bg-white/15 text-[#e0f39a]" },
} satisfies Record<string, { icon: IconName; surface: string; badge: string }>;

const negativeBalance = { surface: "border-[#762f3c] bg-[#762f3c] text-white", badge: "bg-white/15 text-[#ffdce3]" };

export function Dashboard() {
  const { overviewPeriod } = useAccount();
  return <DashboardContent key={overviewPeriod} defaultPeriod={overviewPeriod} />;
}

function DashboardContent({ defaultPeriod }: { defaultPeriod: OverviewPeriod }) {
  const { report } = useLedger();
  const { displayName, weekStartDay, remote } = useAccount();
  const [summaryPeriod, setSummaryPeriod] = useState(defaultPeriod);
  const [chartPeriod, setChartPeriod] = useState<SavingsPeriod>(defaultPeriod);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const categoryPeriod = report.chart.find((period) => period.start === selectedPeriod)?.start ?? report.start;
  const summary = report.overview(summaryPeriod, weekStartDay);
  const today = localToday();

  return (
    <div className="mx-auto max-w-7xl space-y-3 sm:space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-[#59685e]">{summary.range}</p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight">Overview</h1>
          {displayName && <p className="mt-1 break-words text-sm text-[#59685e]">Hi, {displayName}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/products" aria-label="Search purchases" className="grid size-11 place-items-center rounded-xl border border-[#e2e7e0] bg-white"><Icon name="search" className="size-5" /></Link>
          <button aria-label="Notifications" onClick={() => setNotice("Notifications are not available yet.")} className="grid size-11 place-items-center rounded-xl border border-[#e2e7e0] bg-white"><Icon name="bell" className="size-5" /></button>
          <AddTransactionButton />
        </div>
      </header>

      <section className="grid grid-cols-6 gap-2 sm:grid-cols-5 sm:gap-3" aria-label="Spending summary">
        {summary.cards.map((card) => {
          const { icon, surface, badge } = cardStyles[card.id];
          const colors = card.id === "balance" && summary.left < 0 ? negativeBalance : { surface, badge };
          const columns = card.id === "income" || card.id === "balance" ? "col-span-3" : "col-span-2";
          return (
            <div key={card.id} className={columns + " min-w-0 rounded-2xl border p-2.5 sm:col-span-1 sm:p-3 lg:p-4 " + colors.surface}>
              <span className={"mb-1 grid size-6 place-items-center rounded-lg sm:size-8 " + colors.badge}>
                <Icon name={icon} className="size-3.5 sm:size-4" />
              </span>
              <p className="text-[11px] font-medium leading-tight sm:text-xs">{card.title}</p>
              <p className="mt-0.5 break-words text-base font-semibold leading-tight tracking-tight tabular-nums sm:mt-1 sm:text-xl lg:text-2xl">{card.value}</p>
              <p className="mt-1 hidden text-xs opacity-85 sm:block">{card.note}</p>
            </div>
          );
        })}
      </section>

      <BudgetNotices rows={report.rows} today={today} monthStart={report.start} weekStartDay={weekStartDay} />

      <section className="grid gap-4 xl:grid-cols-2">
        <CashFlowChart rows={report.rows} today={today} periodStart={report.start} nextPeriodStart={report.nextStart}
          weekStartDay={weekStartDay} allocations={remote?.data?.goalAllocations} range={chartPeriod}
          onRangeChange={(period) => {
            setChartPeriod(period);
            if (period !== "year") setSummaryPeriod(period);
          }} />
        <div className="grid content-start gap-2">
          <CategoryChart categories={report.categories(categoryPeriod)} period={"From " + formatReceiptDate(categoryPeriod)} />
          <label className="flex items-center justify-end gap-2 text-xs text-[#59685e]">
            Category month
            <select value={categoryPeriod} onChange={(event) => setSelectedPeriod(event.target.value)} className="min-h-11 rounded-xl border border-[#e4e9e2] bg-white px-3 text-sm">
              {report.chart.map(({ month, start }) => <option key={start} value={start}>{monthLabel(month)}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-[#e4e9e2] bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Recent activity</h2>
          <Link href="/transactions" className="text-sm font-semibold text-[#31533c]">View all →</Link>
        </div>
        <ul className="mt-2 divide-y divide-[#edf0ec]">
          {report.rows.slice(0, 4).map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span>
                {row.name}
                <span className="block text-xs text-[#59685e]">{row.category} · {formatReceiptDate(row.date)}{row.merchant && " · " + row.merchant}</span>
              </span>
              <span className="shrink-0 tabular-nums">{formatMinor(row.amountMinor)}</span>
            </li>
          ))}
        </ul>
      </section>

      <Link href="/insights" className="flex min-h-12 items-center justify-between rounded-2xl bg-[#183c31] px-4 py-3 text-sm font-semibold text-white">
        <span className="flex items-center gap-2"><Icon name="sparkles" className="size-4 text-[#d8ee79]" />Explore spending insights</span>
        <span aria-hidden="true">→</span>
      </Link>

      <AboutOopsie />

      {notice && <Toast dismiss={() => setNotice(null)}>{notice}</Toast>}
    </div>
  );
}
