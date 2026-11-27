"use client";

import { useState } from "react";
import { GoalSavingsDialog } from "./goal-savings-dialog";
import { Toast } from "@/components/layout/toast";
import { formatMinor, monthLabel } from "@/lib/finance-format";
import type { GoalAllocation, SavingsPeriod } from "@/lib/goal-savings";
import { useLocalPlanning } from "@/lib/local-planning";
import type { ManualEntry } from "@/lib/ledger";

const ranges = ["Week", "Month", "Year"] as const;
type Range = typeof ranges[number];
const day = 86_400_000;
const shortDate = new Intl.DateTimeFormat("en-IE", { month: "short", day: "numeric", timeZone: "UTC" });
const weekday = new Intl.DateTimeFormat("en-IE", { weekday: "short", timeZone: "UTC" });
const series = { spending: "#173b68", income: "#397bb3", left: "#13745c" } as const;

function makePoints(rows: ManualEntry[], today: string, periodStart: string, nextPeriodStart: string, range: Range, weekStartDay: number, allocations: GoalAllocation[]) {
  const through = Date.parse(today);
  const daysSinceWeekStart = (new Date(through).getUTCDay() + 7 - weekStartDay) % 7;
  const start = range === "Week" ? through - daysSinceWeekStart * day
    : Date.parse(range === "Month" ? periodStart : today.slice(0, 4) + "-01-01");
  const end = range === "Week" ? start + 7 * day : range === "Month" ? Date.parse(nextPeriodStart)
    : Date.UTC(Number(today.slice(0, 4)) + 1, 0, 1);
  const buckets = new Map<string, { label: string; description: string; spending: number; income: number; savings: number; upcoming: boolean }>();
  const key = (date: number) => new Date(date).toISOString().slice(0, range === "Year" ? 7 : 10);
  for (let date = start; date < end; date += day) {
    const bucket = key(date);
    if (buckets.has(bucket)) continue;
    const label = range === "Year" ? monthLabel(bucket, "short") : range === "Week" ? weekday.format(date) : shortDate.format(date);
    const description = range === "Year" ? monthLabel(bucket) : shortDate.format(date);
    buckets.set(bucket, { label, description, spending: 0, income: 0, savings: 0, upcoming: date > through });
  }
  for (const allocation of allocations) {
    const date = Date.parse(allocation.allocated_on);
    if (date < start || date > through || date >= end) continue;
    const point = buckets.get(key(date));
    if (point) point.savings += allocation.amount_minor;
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
  let left = 0;
  const points = Array.from(buckets.values(), (point) => {
    left += point.income - point.spending - point.savings;
    return { ...point, left };
  });
  return { points, dates: shortDate.format(start) + " – " + shortDate.format(end - day) };
}

export function CashFlowChart({ rows, today, periodStart, nextPeriodStart, weekStartDay, allocations }: {
  rows: ManualEntry[]; today: string; periodStart: string; nextPeriodStart: string; weekStartDay: number; allocations?: GoalAllocation[];
}) {
  const [range, setRange] = useState<Range>("Week");
  const [selected, setSelected] = useState<number | null>(null);
  const [savingsOpen, setSavingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const { points, dates } = makePoints(rows, today, periodStart, nextPeriodStart, range, weekStartDay, allocations ?? []);
  const elapsed = points.filter((point) => !point.upcoming);
  const peak = Math.max(0, ...elapsed.map(({ spending, income, left }) => Math.max(spending, income, left)));
  const low = Math.min(0, ...elapsed.map(({ left }) => left));
  const scale = peak || low ? Math.max(1, 10 ** Math.floor(Math.log10((peak - low) / 2))) : 1000;
  const top = Math.ceil(peak / scale) * scale || scale;
  const bottom = Math.floor(low / scale) * scale;
  const period = range.toLowerCase() as SavingsPeriod;
  const leftLabel = "Left this " + period;
  const ticks = [top, bottom < 0 ? 0 : Math.round(top / 2), bottom];
  const x = (index: number) => points.length === 1 ? 50 : 100 * index / (points.length - 1);
  const y = (amount: number) => 96 - 92 * (amount - bottom) / (top - bottom);
  const activeIndex = selected ?? elapsed.length - 1;
  const active = points[activeIndex];
  const balance = elapsed.at(-1)?.left ?? 0;

  return (
    <figure className="min-w-0 rounded-2xl border border-[#dce5ef] bg-white p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="font-semibold text-[#112d52]">
          Spending &amp; income
          <span className="block text-[11px] font-medium text-[#385777]">This {range.toLowerCase()} · {dates}</span>
        </figcaption>
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
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <p className="font-semibold tabular-nums text-[#13745c]"><span aria-hidden>● </span>{leftLabel} {formatMinor(balance)}
          {!active.upcoming && active.left !== balance && <span className="ml-2 font-normal text-[#385777]">{active.description} · {formatMinor(active.left)}</span>}
        </p>
        {!useLocalPlanning && allocations && balance > 0 && <button type="button" onClick={() => setSavingsOpen(true)}
          className="min-h-10 rounded-lg bg-[#edf4ed] px-2.5 font-semibold text-[#1e5945]">Put into goal savings</button>}
      </div>
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2">
        <div aria-hidden className="relative text-right text-[10px] tabular-nums text-[#385777]">
          {Array.from(new Set(ticks)).map((amount) => <span key={amount} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: y(amount) + "%" }}>{formatMinor(amount).replace(/\.00$/, "")}</span>)}
          <span className="invisible">{formatMinor(Math.abs(bottom) > top ? bottom : top)}</span>
        </div>
        <div className="relative mx-2 h-[86px] sm:h-40">
          <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            {Array.from(new Set(ticks)).map((level) => <path key={level} d={"M 0 " + y(level) + " H 100"} stroke={level === 0 ? "#c2d2e4" : "#e1e9f2"} vectorEffect="non-scaling-stroke" />)}
            <path d={"M " + x(activeIndex) + " 4 V 96"} stroke="#c2d2e4" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            {(Object.keys(series) as (keyof typeof series)[]).map((key) => (
              <polyline key={key} points={elapsed.map((point, index) => x(index) + "," + y(point[key])).join(" ")} fill="none"
                stroke={series[key]} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray={key === "left" ? "5 3" : undefined} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {points.map((point, index) => (
            <button key={point.description} style={{ left: x(index) + "%", width: 100 / (points.length - 1) + "%" }} onFocus={() => setSelected(index)} onClick={() => setSelected(index)}
              aria-label={point.description + (point.upcoming ? ". Upcoming" : ". Spending " + formatMinor(point.spending) + ". Income " + formatMinor(point.income) + ". " + leftLabel + " " + formatMinor(point.left))}
              aria-pressed={activeIndex === index} className="absolute inset-y-0 -translate-x-1/2 rounded focus-visible:outline-2 focus-visible:outline-[#397bb3]">
              <span aria-hidden="true" className={"pointer-events-none absolute left-1/2 size-1 -translate-1/2 rounded-full " + (point.upcoming ? "bg-[#a8bbce]" : "bg-[#173b68]")}
                style={{ top: y(point.spending) + "%" }} />
            </button>
          ))}
          {!active.upcoming && (Object.keys(series) as (keyof typeof series)[]).map((key) => (
            <span key={key} aria-hidden className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: x(activeIndex) + "%", top: y(active[key]) + "%", backgroundColor: series[key] }} />
          ))}
        </div>
        <div aria-hidden className="relative col-start-2 mx-2 mt-1 h-4 text-[10px] text-[#385777]">
          {points.map(({ label }, index) => {
            const tick = range !== "Month" || (index < points.length - 3 && index % 7 === 0) || index === points.length - 1;
            return tick && <span key={index} style={{ left: x(index) + "%" }}
              className="absolute -translate-x-1/2 whitespace-nowrap">{label}</span>;
          })}
        </div>
      </div>
      {savingsOpen && allocations && <GoalSavingsDialog balance={balance} period={period} allocations={allocations}
        onClose={() => setSavingsOpen(false)} onSaved={(amount) => { setSavingsOpen(false); setNotice(formatMinor(amount) + " recorded in goal savings."); }} />}
      {notice && <Toast dismiss={() => setNotice("")}>{notice}</Toast>}
    </figure>
  );
}
