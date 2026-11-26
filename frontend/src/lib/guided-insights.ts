import { formatMinor, formatReceiptDate } from "./finance-format";
import type { ledgerReport } from "./ledger";
import type { Receipt } from "./receipts";

export const receiptHistoryMinimum = 10;
const dayMilliseconds = 86_400_000;
type Report = ReturnType<typeof ledgerReport>;

export type InsightAnswer = {
  title: string;
  detail: string;
  facts?: { label: string; value: string }[];
};

export function savingsAnswer(target: number, periods: number, current: Report["current"]): InsightAnswer {
  const perPeriod = Math.ceil(target / periods);
  return {
    title: "Your savings target",
    detail: current.income === 0 ? "Log your income to give this target more context."
      : "The amount left is income minus spending recorded so far. Expenses still to come can change it.",
    facts: [
      { label: "Target amount", value: formatMinor(target) },
      { label: "Set aside per reporting period", value: formatMinor(perPeriod) },
      ...(current.income > 0 ? [{ label: "Recorded amount left this period", value: formatMinor(current.net) }] : []),
    ],
  };
}

export function spendingReductionAnswer(category: string, amount: number): InsightAnswer {
  const reduction = Math.round(amount / 10);
  return {
    title: "Try a 10% reduction",
    detail: "Use this as a spending target for " + category + ", based on what you’ve recorded this period.",
    facts: [
      { label: "Spent so far", value: formatMinor(amount) },
      { label: "10% less", value: formatMinor(reduction) },
      { label: "Example spending cap", value: formatMinor(amount - reduction) },
    ],
  };
}

export function spendingSummaryAnswer(report: Report, previous: boolean): InsightAnswer {
  const period = previous ? report.chart[1] : report.chart[2];
  const categories = report.categories(period.start).slice(0, 3);
  return {
    title: previous ? "Last period at a glance" : "This period so far",
    detail: categories.length ? "Your largest categories are shown with their share of recorded spending."
      : "There’s no recorded spending for this period yet.",
    facts: [
      { label: "Recorded spending", value: formatMinor(period.spent) },
      { label: "Recorded income", value: formatMinor(period.income) },
      ...categories.map(({ label, amount }) => ({
        label, value: formatMinor(amount) + " · " + Math.round(amount / period.spent * 100) + "%",
      })),
    ],
  };
}

export function periodComparisonAnswer(report: Report, today: string): InsightAnswer {
  const previous = report.chart[1].start;
  const currentStart = Date.parse(report.start);
  const previousStart = Date.parse(previous);
  const elapsed = Math.min(Date.parse(today) - currentStart, currentStart - previousStart - dayMilliseconds);
  const currentThrough = new Date(currentStart + elapsed).toISOString().slice(0, 10);
  const previousThrough = new Date(previousStart + elapsed).toISOString().slice(0, 10);
  const currentRows = report.rows.filter(({ date }) => date >= report.start && date <= currentThrough);
  const previousRows = report.rows.filter(({ date }) => date >= previous && date <= previousThrough);
  if (!currentRows.length || !previousRows.length) {
    return { title: "More history needed", detail: "Record activity in both reporting periods to compare spending through the same point in each period." };
  }
  const spent = (rows: Report["rows"]) => rows.reduce((sum, row) => sum + Math.max(0, -row.amountMinor), 0);
  const currentSpent = spent(currentRows);
  const previousSpent = spent(previousRows);
  const difference = currentSpent - previousSpent;
  return {
    title: difference === 0 ? "Recorded spending is the same" : "You’ve recorded " + formatMinor(Math.abs(difference)) + (difference > 0 ? " more" : " less"),
    detail: "Compares the start of each reporting period through the same elapsed day, up to the end of the shorter period.",
    facts: [
      { label: "This period through " + formatReceiptDate(currentThrough), value: formatMinor(currentSpent) },
      { label: "Last period through " + formatReceiptDate(previousThrough), value: formatMinor(previousSpent) },
    ],
  };
}

export function receiptHistoryAnswer(records: Receipt[]): InsightAnswer {
  const [topStore] = [...records.reduce((stores, receipt) => {
    const name = receipt.store.trim();
    const key = name.toLowerCase();
    const store = stores.get(key) ?? { name, count: 0 };
    store.count += 1;
    return stores.set(key, store);
  }, new Map<string, { name: string; count: number }>()).values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const largestLine = records.flatMap(({ lines }) => lines).filter(({ kind }) => kind === "product")
    .reduce<Receipt["lines"][number] | undefined>((largest, item) =>
      !largest || item.amount_minor > largest.amount_minor ? item : largest, undefined);
  return {
    title: "What your receipts show",
    detail: "Based on all your saved receipts. Item prices are before receipt-level discounts.",
    facts: [
      { label: "Total on saved receipts", value: formatMinor(records.reduce((sum, receipt) => sum + receipt.total_minor, 0)) },
      ...(topStore ? [{ label: "Store with the most receipts", value: topStore.name + " · " + topStore.count }] : []),
      ...(largestLine ? [{ label: "Highest-priced line · " + largestLine.display_name, value: formatMinor(largestLine.amount_minor) }] : []),
    ],
  };
}
