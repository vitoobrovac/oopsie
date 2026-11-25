"use client";


import { DeleteTransaction } from "@/components/features/delete-transaction";
import { FeaturePage } from "@/components/features/feature-page";
import { PageShell } from "@/components/layout/page-shell";
import { AddTransactionButton } from "@/components/features/add-transaction";
import { useLedger } from "@/lib/use-ledger";
import { formatMinor, formatReceiptDate } from "@/lib/finance-format";

export default function TransactionsPage() {
  const { report, canWrite, deleteEntry } = useLedger();
  return (
    <PageShell>
      <FeaturePage title="Transactions" description="Your recorded income and expenses." action={<AddTransactionButton />} cards={[]}>
        <section className="rounded-2xl border border-[#e4e9e2] bg-white p-4 sm:p-6">
          <h2 className="font-semibold">All activity · {report.rows.length} entries</h2>
          {!report.rows.length && <p className="mt-2 text-sm text-[#59685e]">Your saved transactions will appear here.</p>}
          <ul className="mt-2 divide-y divide-[#edf0ec]">
            {report.rows.map((row) => (
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
        </section>
      </FeaturePage>
    </PageShell>
  );
}
