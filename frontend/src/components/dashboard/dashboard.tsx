
"use client";

import Link from "next/link";
import { useState } from "react";
import { Toast } from "@/components/layout/toast";
import { AddTransactionButton } from "@/components/features/add-transaction";
import { useLedger } from "@/lib/use-ledger";
import { Icon } from "@/components/layout/icon";
import { CategoryChart, MonthlyChart } from "@/components/dashboard/finance-charts";
import { formatMinor, formatReceiptDate, monthLabel } from "@/lib/finance-format";

export function Dashboard() {
  const { report } = useLedger();
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const categoryPeriod = report.chart.find((period) => period.start === selectedPeriod)?.start ?? report.start;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-[#59685e]">{report.range}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-[#59685e]">Your spending and income</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/products" aria-label="Search purchases" className="grid size-11 place-items-center rounded-xl border border-[#e2e7e0] bg-white"><Icon name="search" className="size-5" /></Link>
          <button aria-label="Notifications" onClick={() => setNotice("Notifications are not available yet.")} className="grid size-11 place-items-center rounded-xl border border-[#e2e7e0] bg-white"><Icon name="bell" className="size-5" /></button>
          <AddTransactionButton />
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-5" aria-label="Spending summary">
        {report.cards.map((card) => (
          <div key={card.title} className="rounded-2xl border border-[#e4e9e2] bg-white p-3 sm:p-5">
            <p className="text-xs text-[#59685e]">{card.title}</p>
            <p className="mt-1 text-lg font-semibold tracking-tight tabular-nums sm:text-2xl">{card.value}</p>
            <p className="mt-1 text-xs text-[#59685e]">{card.note}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <MonthlyChart data={report.chart} showIncome />
        <div className="grid content-start gap-2">
          <CategoryChart categories={report.categories(categoryPeriod)} period={"From " + formatReceiptDate(categoryPeriod)} />
          <label className="flex items-center justify-end gap-2 text-xs text-[#59685e]">
            Category period
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

      {notice && <Toast dismiss={() => setNotice(null)}>{notice}</Toast>}
    </div>
  );
}
