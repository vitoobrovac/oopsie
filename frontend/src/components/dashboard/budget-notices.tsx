"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { accountRequest, useAccount } from "@/components/account/account-provider";
import { budgetUsage } from "@/lib/budgets";
import { formatMinor } from "@/lib/finance-format";
import type { ManualEntry } from "@/lib/ledger";
import { listLocalPlans, useLocalPlanning, type Budget } from "@/lib/local-planning";

export function BudgetNotices({ rows, today, monthStart, weekStartDay }: {
  rows: ManualEntry[]; today: string; monthStart: string; weekStartDay: number;
}) {
  const { session } = useAccount();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const pending = useLocalPlanning
      ? Promise.resolve().then(() => listLocalPlans(session.user.id, "budgets") as Budget[])
      : accountRequest<Budget[]>(session, "planning/budgets", { signal: controller.signal });
    void pending.then((records) => { if (!controller.signal.aborted) setBudgets(records); }, () => undefined);
    return () => controller.abort();
  }, [session]);
  const notices = budgets.map((budget) => ({ budget, ...budgetUsage(budget, rows, today, monthStart, weekStartDay) }))
    .filter(({ fraction }) => fraction >= 0.8).sort((a, b) => b.fraction - a.fraction);
  if (notices.length === 0) return null;
  return <section aria-label="Budget alerts" className="rounded-xl border border-[#f0ddbd] bg-[#fff7e8] px-3 py-2 text-[#603b1d]">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">Budget alerts</h2>
      <Link href="/budgets" className="inline-flex min-h-10 items-center text-xs font-semibold underline">View budgets{notices.length > 3 ? " (" + notices.length + ")" : ""}</Link>
    </div>
    <ul className="space-y-1 pb-1 text-xs">
      {notices.slice(0, 3).map(({ budget, remaining, label }) => <li key={budget.id}>
        <strong>{budget.category}</strong> · {remaining < 0 ? formatMinor(-remaining) + " over budget" : remaining === 0 ? "Limit reached" : formatMinor(remaining) + " left before your limit"}
        <span className="block opacity-85">{label}</span>
      </li>)}
    </ul>
  </section>;
}
