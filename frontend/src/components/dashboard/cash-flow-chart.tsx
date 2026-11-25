"use client";

import { useState } from "react";
import { formatMinor, monthLabel } from "@/lib/finance-format";
import type { ManualEntry } from "@/lib/ledger";

const ranges = ["Week", "Month", "Year"] as const;
type Range = typeof ranges[number];
const day = 86_400_000;
const shortDate = new Intl.DateTimeFormat("en-IE", { month: "short", day: "numeric", timeZone: "UTC" });
const weekday = new Intl.DateTimeFormat("en-IE", { weekday: "short", timeZone: "UTC" });

function makePoints(rows: ManualEntry[], today: string, periodStart: string, range: Range) {
  const end = Date.parse(today);
  const start = range === "Week" ? end - 6 * day
    : Date.parse(range === "Month" ? periodStart : today.slice(0, 4) + "-01-01");
  const buckets = new Map<string, { label: string; description: string; spending: number; income: number }>();
  const key = (date: number) => range === "Year" ? new Date(date).toISOString().slice(0, 7)
    : String(Math.floor((date - start) / (range === "Month" ? 7 * day : day)));
  for (let date = start; date <= end; date += day) {
    const bucket = key(date);
    if (buckets.has(bucket)) continue;
    const label = range === "Year" ? monthLabel(bucket, "short") : range === "Week" ? weekday.format(date) : shortDate.format(date);
    const description = range === "Year" ? monthLabel(bucket)
      : range === "Week" ? shortDate.format(date) : shortDate.formatRange(date, Math.min(date + 6 * day, end));
    buckets.set(bucket, { label, description, spending: 0, income: 0 });
  }
  for (const row of rows) {
    const date = Date.parse(row.date);
    if (date < start || date > end) continue;
    const point = buckets.get(key(date));
    if (point) {
      point.spending += Math.max(0, -row.amountMinor);
      point.income += Math.max(0, row.amountMinor);
    }
  }
  return [...buckets.values()];
}

export function CashFlowChart({ rows, today, periodStart }: { rows: ManualEntry[]; today: string; periodStart: string }) {
  const [range, setRange] = useState<Range>("Week");
  const [selected, setSelected] = useState<number | null>(null);
  const points = makePoints(rows, today, periodStart, range);
  const peak = Math.max(0, ...points.map(({ spending, income }) => Math.max(spending, income)));
  const scale = peak ? Math.max(1, 10 ** Math.floor(Math.log10(peak / 2))) : 1000;
  const top = peak ? Math.ceil(peak / (scale * 2)) * scale * 2 : 2000;
  const x = (index: number) => points.length === 1 ? 50 : 100 * index / (points.length - 1);
  const y = (amount: number) => 96 - 92 * amount / top;
  const activeIndex = Math.min(selected ?? points.length - 1, points.length - 1);
  const active = points[activeIndex];

  return (
    <figure className="min-w-0 rounded-2xl border border-[#dce5ef] bg-white p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="font-semibold text-[#112d52]">Spending &amp; income</figcaption>
        <div className="flex rounded-xl bg-[#eef3f9] p-0.5" role="group" aria-label="Cash flow period">
          {ranges.map((option) => (
            <button key={option} aria-pressed={range === option} className="min-h-9 rounded-lg px-2.5 text-xs font-semibold text-[#385777] aria-pressed:bg-[#14365d] aria-pressed:text-white"
              onClick={() => { setRange(option); setSelected(null); }}>{option}</button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 text-[11px] tabular-nums text-[#385777]">
        <span>{active.description}</span>
        <span><span aria-hidden className="text-[#173b68]">● </span>Spent {formatMinor(active.spending)}</span>
        <span><span aria-hidden className="text-[#397bb3]">● </span>Income {formatMinor(active.income)}</span>
      </div>
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2">
        <div aria-hidden className="flex flex-col justify-between text-right text-[10px] tabular-nums text-[#385777]">
          {[top, top / 2, 0].map((amount) => <span key={amount}>{formatMinor(amount).replace(/\.00$/, "")}</span>)}
        </div>
        <div className="relative mx-2 h-[86px] sm:h-40">
          <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            {[4, 50, 96].map((level) => <path key={level} d={"M 0 " + level + " H 100"} stroke="#e1e9f2" vectorEffect="non-scaling-stroke" />)}
            <path d={"M " + x(activeIndex) + " 4 V 96"} stroke="#c2d2e4" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            {(["spending", "income"] as const).map((key) => (
              <polyline key={key} points={points.map((point, index) => x(index) + "," + y(point[key])).join(" ")} fill="none"
                stroke={key === "spending" ? "#173b68" : "#397bb3"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {points.map((point, index) => (
            <button key={point.description} style={{ left: x(index) + "%" }} onFocus={() => setSelected(index)} onClick={() => setSelected(index)}
              aria-label={point.description + ". Spending " + formatMinor(point.spending) + ". Income " + formatMinor(point.income)}
              aria-pressed={activeIndex === index} className="absolute inset-y-0 w-6 -translate-x-1/2 rounded focus-visible:outline-2 focus-visible:outline-[#397bb3]" />
          ))}
          <span aria-hidden className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#173b68]" style={{ left: x(activeIndex) + "%", top: y(active.spending) + "%" }} />
          {active.income !== active.spending && <span aria-hidden className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#397bb3]" style={{ left: x(activeIndex) + "%", top: y(active.income) + "%" }} />}
        </div>
        <div aria-hidden className="relative col-start-2 mx-2 mt-1 h-4 text-[10px] text-[#385777]">
          {points.map(({ label }, index) => (
            points.length <= 7 || index % 2 === 0 ? <span key={index} style={{ left: x(index) + "%" }} className="absolute -translate-x-1/2 whitespace-nowrap">{label}</span> : null
          ))}
        </div>
      </div>
    </figure>
  );
}
