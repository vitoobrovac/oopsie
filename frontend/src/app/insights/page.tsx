
"use client";

import Link from "next/link";
import { useState } from "react";
import { FeaturePage } from "@/components/features/feature-page";
import { GuidedInsights } from "@/components/features/guided-insights";
import { PageShell } from "@/components/layout/page-shell";
import { CategoryChart, MonthlyChart } from "@/components/dashboard/finance-charts";
import { formatMinor, formatReceiptDate } from "@/lib/finance-format";
import { periodStart } from "@/lib/ledger";
import { productEmoji } from "@/lib/product-icons";
import { localToday, useLedger } from "@/lib/use-ledger";
import { useReceipts } from "@/lib/use-receipts";

const ranges = { current: "This period", previous: "Last period", all: "All time" };
type Range = keyof typeof ranges;
const panel = "min-w-0 rounded-2xl border border-[#e4e9e2] bg-white p-4 sm:p-6";
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function InsightsPage() {
  const receipts = useReceipts();
  return <PageShell><Insights receipts={receipts} /></PageShell>;
}

function Insights({ receipts }: { receipts: ReturnType<typeof useReceipts> }) {
  const { report, monthStartDay } = useLedger();
  const { records, error, retry } = receipts;
  const [range, setRange] = useState<Range>("current");
  const selectedStart = range === "previous" ? report.chart[1].start : report.start;
  const today = localToday();
  const inRange = (date: string) => date <= today && (range === "all" || periodStart(date, monthStartDay) === selectedStart);

  const spending = report.rows.filter((row) => row.amountMinor < 0 && inRange(row.date));
  const categoryTotals = new Map<string, number>();
  const merchantTotals = new Map<string, { label: string; amount: number }>();
  const weekdayTotals = days.map(() => 0);
  for (const entry of spending) {
    const amount = -entry.amountMinor;
    categoryTotals.set(entry.category, (categoryTotals.get(entry.category) ?? 0) + amount);
    const merchant = entry.merchant.trim();
    if (merchant) {
      const key = merchant.toLowerCase();
      const existing = merchantTotals.get(key);
      merchantTotals.set(key, { label: existing?.label ?? merchant, amount: (existing?.amount ?? 0) + amount });
    }
    const weekday = new Date(entry.date).getUTCDay();
    weekdayTotals[(weekday + 6) % 7] += amount;
  }
  const categories = [...categoryTotals].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  const merchants = [...merchantTotals.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
  const purchases = (records ?? []).filter((receipt) => inRange(receipt.purchased_on)).flatMap((receipt) =>
    receipt.lines.filter((item) => item.kind === "product" && item.amount_minor > 0).map((item) => ({ item, receipt })),
  ).sort((a, b) => b.item.amount_minor - a.item.amount_minor).slice(0, 5);

  const currentCategories = new Map(report.categories().map(({ label, amount }) => [label, amount]));
  const previousCategories = new Map(report.categories(report.chart[1].start).map(({ label, amount }) => [label, amount]));
  const comparison = [...new Set([...currentCategories.keys(), ...previousCategories.keys()])]
    .map((label) => ({ label, current: currentCategories.get(label) ?? 0, previous: previousCategories.get(label) ?? 0 }))
    .sort((a, b) => b.current + b.previous - a.current - a.previous).slice(0, 5);
  const comparisonMax = Math.max(1, ...comparison.flatMap(({ current, previous }) => [current, previous]));
  const weekdayMax = Math.max(1, ...weekdayTotals);

  return (
    <FeaturePage title="Insights" description="See what you spent the most on and how your spending changes."
      action={<GuidedInsights report={report} today={today} records={records} receiptError={error} retryReceipts={retry} />} cards={[]}>
      <label className="flex flex-wrap items-center gap-2 text-sm font-medium">
        Insight period
        <select value={range} onChange={(event) => setRange(event.target.value as Range)}
          className="min-h-11 rounded-xl border border-[#dce4d9] bg-white px-3">
          {Object.entries(ranges).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>

      <div className="grid gap-4 lg:grid-cols-2">
        <CategoryChart categories={categories} period={ranges[range]} />
        <figure className={panel}>
          <figcaption className="font-semibold">Category comparison</figcaption>
          <p className="mt-1 text-xs text-[#59685e]">This period to date and the full previous period</p>
          {comparison.length ? (
            <ul className="mt-4 space-y-3">
              {comparison.map(({ label, current, previous }) => (
                <li key={label} className="space-y-1.5">
                  <p className="text-sm font-medium">{label}</p>
                  <ComparisonBar label="This period" amount={current} maximum={comparisonMax} color="bg-[#27634e]" />
                  <ComparisonBar label="Last period" amount={previous} maximum={comparisonMax} color="bg-[#8b94c0]" />
                </li>
              ))}
            </ul>
          ) : <p className="mt-4 text-sm text-[#59685e]">No spending to compare yet.</p>}
        </figure>

        <section className={panel}>
          <h2 className="font-semibold">Most expensive items</h2>
          <p className="mt-1 text-xs text-[#59685e]">Individual receipt lines · {ranges[range]}</p>
          {error ? <p role="alert" className="mt-3 text-sm">{error} <button onClick={retry} className="underline">Retry</button></p>
            : !records ? <p role="status" className="mt-3 text-sm">Loading purchases…</p>
            : !purchases.length ? <p className="mt-3 text-sm text-[#59685e]">No saved receipt items in this period.</p>
            : <ol className="mt-2 divide-y divide-[#edf1eb]">
              {purchases.map(({ item, receipt }) => (
                <li key={receipt.id + ":" + item.position}>
                  <Link href={"/receipts?receipt=" + receipt.id} className="flex min-h-12 items-center gap-3 py-2 text-sm">
                    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#edf4e9]">{productEmoji(item.display_name, item.category)}</span>
                    <span className="min-w-0 flex-1 break-words font-medium">{item.display_name}
                      <span className="block text-xs font-normal text-[#59685e]">{receipt.store} · {formatReceiptDate(receipt.purchased_on)}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{formatMinor(item.amount_minor)}</span>
                  </Link>
                </li>
              ))}
            </ol>}
        </section>

        <section className={panel}>
          <h2 className="font-semibold">Top stores by spending</h2>
          <p className="mt-1 text-xs text-[#59685e]">{ranges[range]} · Transactions with a merchant</p>
          {merchants.length ? <ol className="mt-3 divide-y divide-[#edf1eb]">
            {merchants.map(({ label, amount }) => (
              <li key={label} className="flex min-h-11 items-center justify-between gap-2 text-sm">
                <span className="min-w-0 break-words">{label}</span><span className="shrink-0 font-semibold tabular-nums">{formatMinor(amount)}</span>
              </li>
            ))}
          </ol> : <p className="mt-3 text-sm text-[#59685e]">No merchant spending recorded in this period.</p>}
        </section>

        <figure className={panel}>
          <figcaption className="font-semibold">Spending by weekday</figcaption>
          <p className="mt-1 text-xs text-[#59685e]">Total spent on each day of the week · {ranges[range]}</p>
          <div className="mt-4 grid grid-cols-7 gap-1.5 text-center text-xs sm:gap-2">
            {days.map((day, index) => (
              <div key={day} className="min-w-0">
                <div aria-hidden="true" className="flex h-20 items-end justify-center border-b border-[#e4e9e2]">
                  <span className="w-3/4 rounded-t-md bg-[#407c9e]" style={{ height: weekdayTotals[index] / weekdayMax * 100 + "%" }} />
                </div>
                <p className="mt-2 font-medium">{day}</p>
                <p className="mt-1 break-all text-[10px] tabular-nums text-[#59685e]">{formatMinor(weekdayTotals[index])}</p>
              </div>
            ))}
          </div>
        </figure>
        <MonthlyChart data={report.chart} />
      </div>
    </FeaturePage>
  );
}

function ComparisonBar({ label, amount, maximum, color }: { label: string; amount: number; maximum: number; color: string }) {
  return (
    <div className="grid grid-cols-[5.25rem_1fr_auto] items-center gap-2 text-[11px] text-[#59685e]">
      <span>{label}</span>
      <span aria-hidden="true" className="h-2 rounded-full bg-[#eef2ec]">
        <span className={"block h-full rounded-full " + color} style={{ width: amount / maximum * 100 + "%" }} />
      </span>
      <span className="tabular-nums">{formatMinor(amount)}</span>
    </div>
  );
}
