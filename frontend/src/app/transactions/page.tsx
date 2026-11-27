"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { DeleteTransaction } from "@/components/features/delete-transaction";
import { FeaturePage } from "@/components/features/feature-page";
import { PageShell } from "@/components/layout/page-shell";
import { AddTransactionButton } from "@/components/features/add-transaction";
import { RecurringIncome } from "@/components/features/recurring-income";
import { useLedger } from "@/lib/use-ledger";
import { formatMinor, formatReceiptDate } from "@/lib/finance-format";

export default function TransactionsPage() {
  return <PageShell><Suspense fallback={<p role="status" className="text-sm">Loading activity…</p>}><Activity /></Suspense></PageShell>;
}

function Activity() {
  const { report, canWrite, deleteEntry } = useLedger();
  const savedId = useSearchParams().get("savedReceipt");
  const saved = report.rows.find((row) => row.id === savedId);
  const [visible, setVisible] = useState(40);
  return (
      <FeaturePage title="Transactions" description="Your recorded income and expenses." action={<AddTransactionButton />} cards={[]}>
        {saved && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#eaf3e7] px-4 py-3 text-sm text-[#183c31]">
          <p><strong>Receipt saved.</strong> {saved.name} · {formatMinor(Math.abs(saved.amountMinor))}</p>
          <Link href={"/receipts?receipt=" + saved.id} className="inline-flex min-h-9 items-center font-semibold underline">View receipt</Link>
        </div>}
        <RecurringIncome />
        <section className="rounded-2xl border border-[#e4e9e2] bg-white p-4 sm:p-6">
          <h2 className="font-semibold">All activity · {report.rows.length} entries</h2>
          {!report.rows.length && <p className="mt-2 text-sm text-[#59685e]">Your saved transactions will appear here.</p>}
          <ul className="mt-2 divide-y divide-[#edf0ec]">
            {report.rows.slice(0, visible).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>
                  {row.name}
                  <span className="block text-xs text-[#59685e]">{row.category} · {formatReceiptDate(row.date)}{row.merchant && " · " + row.merchant}</span>
                </span>
                <div className="flex shrink-0 items-center gap-1"><span className="tabular-nums">{formatMinor(row.amountMinor)}</span>
                  {canWrite && <DeleteTransaction name={row.name} remove={() => deleteEntry(row.id)} />}
                </div>
              </li>
            ))}
          </ul>
          {report.rows.length > visible && <button type="button" onClick={() => setVisible((count) => count + 40)}
            className="mt-3 min-h-11 rounded-xl border border-[#dce4d9] px-3 text-sm font-semibold text-[#31533c]">Show more activity</button>}
        </section>
      </FeaturePage>
  );
}
