"use client";

import { useState } from "react";
import { formatMinor, monthLabel } from "@/lib/finance-format";
import type { ManualEntry } from "@/lib/ledger";

const ranges = ["Week", "Month", "Year"] as const;
type Range = typeof ranges[number];
const day = 86_400_000;
const shortDate = new Intl.DateTimeFormat("en-IE", { month: "short", day: "numeric", timeZone: "UTC" });
const weekday = new Intl.DateTimeFormat("en-IE", { weekday: "short", timeZone: "UTC" });

function makePoints(rows: ManualEntry[], today: string, periodStart: string, nextPeriodStart: string, range: Range, weekStartDay: number) {
  const through = Date.parse(today);
  const daysSinceWeekStart = (new Date(through).getUTCDay() + 7 - weekStartDay) % 7;
  const start = range === "Week" ? through - daysSinceWeekStart * day
    : Date.parse(range === "Month" ? periodStart : today.slice(0, 4) + "-01-01");
  const end = range === "Week" ? start + 7 * day : range === "Month" ? Date.parse(nextPeriodStart)
    : Date.UTC(Number(today.slice(0, 4)) + 1, 0, 1);
  const buckets = new Map<string, { label: string; description: string; spending: number; income: number; upcoming: boolean }>();
  const key = (date: number) => new Date(date).toISOString().slice(0, range === "Year" ? 7 : 10);
  for (let date = start; date < end; date += day) {
    const bucket = key(date);
    if (buckets.has(bucket)) continue;
    const label = range === "Year" ? monthLabel(bucket, "short") : range === "Week" ? weekday.format(date) : shortDate.format(date);
    const description = range === "Year" ? monthLabel(bucket) : shortDate.format(date);
    buckets.set(bucket, { label, description, spending: 0, income: 0, upcoming: date > through });
  }
  for (const row of rows) {
    const date = Date.parse(row.date);
    if (date < start || date > through || date >= end) continue;
    const point = buckets.get(key(date));
    if (point) {
      point.spending += Math.max(0, -row.amountMinor);
      point.income += Math.max(0, row.amountMinor);
    }
  }
  return [...buckets.values()];
}

export function CashFlowChart({ rows, today, periodStart, nextPeriodStart, weekStartDay }: {
  rows: ManualEntry[]; today: string; periodStart: string; nextPeriodStart: string; weekStartDay: number;
}) {
  const [range, setRange] = useState<Range>("Week");
  const [selected, setSelected] = useState<number | null>(null);
  const points = makePoints(rows, today, periodStart, nextPeriodStart, range, weekStartDay);
  const peak = Math.max(0, ...points.map(({ spending, income }) => Math.max(spending, income)));
  const scale = peak ? Math.max(1, 10 ** Math.floor(Math.log10(peak / 2))) : 1000;
  const top = peak ? Math.ceil(peak / (scale * 2)) * scale * 2 : 2000;
  const x = (index: number) => points.length === 1 ? 50 : 100 * index / (points.length - 1);
  const y = (amount: number) => 96 - 92 * amount / top;
  const activeIndex = selected ?? points.findLastIndex((point) => !point.upcoming);
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
        {active.upcoming ? <span>Upcoming</span> : <>
          <span><span aria-hidden className="text-[#173b68]">● </span>Spent {formatMinor(active.spending)}</span>
          <span><span aria-hidden className="text-[#397bb3]">● </span>Income {formatMinor(active.income)}</span>
        </>}
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
              <polyline key={key} points={points.filter((point) => !point.upcoming).map((point, index) => x(index) + "," + y(point[key])).join(" ")} fill="none"
                stroke={key === "spending" ? "#173b68" : "#397bb3"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {points.map((point, index) => (
            <button key={point.description} style={{ left: x(index) + "%", width: 100 / (points.length - 1) + "%" }} onFocus={() => setSelected(index)} onClick={() => setSelected(index)}
              aria-label={point.description + (point.upcoming ? ". Upcoming" : ". Spending " + formatMinor(point.spending) + ". Income " + formatMinor(point.income))}
              aria-pressed={activeIndex === index} className="absolute inset-y-0 -translate-x-1/2 rounded focus-visible:outline-2 focus-visible:outline-[#397bb3]">
              <span aria-hidden="true" className={"pointer-events-none absolute left-1/2 size-1 -translate-1/2 rounded-full " + (point.upcoming ? "bg-[#a8bbce]" : "bg-[#173b68]")}
                style={{ top: y(point.spending) + "%" }} />
            </button>
          ))}
          <span aria-hidden className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#173b68]" style={{ left: x(activeIndex) + "%", top: y(active.spending) + "%" }} />
          {active.income !== active.spending && <span aria-hidden className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#397bb3]" style={{ left: x(activeIndex) + "%", top: y(active.income) + "%" }} />}
        </div>
        <div aria-hidden className="relative col-start-2 mx-2 mt-1 h-4 text-[10px] text-[#385777]">
          {points.map(({ label }, index) => {
            const tick = range !== "Month" || (index < points.length - 3 && index % 7 === 0) || index === points.length - 1;
            return tick && <span key={index} style={{ left: x(index) + "%" }}
              className="absolute -translate-x-1/2 whitespace-nowrap">{label}</span>;
          })}
        </div>
      </div>
    </figure>
  );
}
