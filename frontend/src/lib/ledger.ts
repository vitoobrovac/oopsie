import { formatMinor, formatReceiptDate } from "./finance-format";

export type ManualEntry = {
  id: string;
  date: string;
  name: string;
  category: string;
  merchant: string;
  amountMinor: number;
};

export function parseAmount(value: string) {
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents > 0 ? cents : null;
}

export function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function monthStart(date: string, day: number, offset = 0) {
  const [year, month] = date.split("-").map(Number);
  const monthIndex = month - 1 + offset;
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function periodStart(date: string, day: number) {
  const start = monthStart(date, day);
  return date >= start ? start : monthStart(date, day, -1);
}

function summarize(rows: ManualEntry[]) {
  const spent = rows.reduce((sum, row) => sum + Math.max(-row.amountMinor, 0), 0);
  const income = rows.reduce((sum, row) => sum + Math.max(row.amountMinor, 0), 0);
  return { spent, income, net: income - spent };
}

export function ledgerReport(entries: ManualEntry[], day: number, today: string) {
  const rows = entries
    .filter((entry) => entry.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const start = periodStart(row.date, day);
    const periodRows = grouped.get(start) ?? [];
    periodRows.push(row);
    grouped.set(start, periodRows);
  }

  const start = periodStart(today, day);
  const previousStart = monthStart(start, day, -1);
  const nextStart = monthStart(start, day, 1);
  const labels = [monthStart(start, day, -2), previousStart, start];
  const getPeriod = (period: string) => summarize(grouped.get(period) ?? []);
  const current = getPeriod(start);
  const previous = getPeriod(previousStart);
  const range = (from: string, until: string) => {
    const end = new Date(until);
    end.setUTCDate(end.getUTCDate() - 1);
    return formatReceiptDate(from) + " – " + formatReceiptDate(end.toISOString());
  };

  return {
    rows, start, current,
    range: range(start, nextStart),
    chart: labels.map((date) => ({ start: date, month: date.slice(0, 7), ...getPeriod(date) })),
    cards: [
      { title: "Overall spent", value: formatMinor(summarize(rows).spent), note: "All recorded activity" },
      { title: "Spent this period", value: formatMinor(current.spent), note: "Through " + formatReceiptDate(today) },
      { title: "Spent last period", value: formatMinor(previous.spent), note: range(previousStart, start) },
      { title: "Income this period", value: formatMinor(current.income), note: "Recorded income" },
      { title: "Left this period", value: formatMinor(current.net), note: "Income minus spending so far" },
    ],
    categories(period = start) {
      const totals = new Map<string, number>();
      for (const row of grouped.get(period) ?? []) {
        if (row.amountMinor < 0) totals.set(row.category, (totals.get(row.category) ?? 0) - row.amountMinor);
      }
      return [...totals].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
    },
  };
}
