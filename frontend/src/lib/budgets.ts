import { formatReceiptDate } from "./finance-format";
import { weekBounds, type ManualEntry } from "./ledger";
import type { Budget, BudgetReset } from "./local-planning";

export const budgetResetLabels: Record<BudgetReset, string> = {
  weekly: "Weekly", monthly: "Monthly", yearly: "Yearly", once: "Never (one-time budget)",
};

export function budgetUsage(budget: Budget, rows: ManualEntry[], today: string, monthStart: string, weekStartDay: number) {
  const reset = budget.reset_period ?? "monthly";
  const start = {
    weekly: weekBounds(today, weekStartDay).start,
    monthly: monthStart,
    yearly: today.slice(0, 4) + "-01-01",
    once: budget.starts_on || today,
  }[reset];
  const category = budget.category.trim().toLowerCase();
  const spent = rows.reduce((total, row) => row.amountMinor < 0 && row.date >= start && row.date <= today
    && row.category.trim().toLowerCase() === category ? total - row.amountMinor : total, 0);
  return { spent, remaining: budget.amount_minor - spent, fraction: spent / budget.amount_minor,
    label: (reset === "once" ? "One-time" : budgetResetLabels[reset]) + " · From " + formatReceiptDate(start) };
}
