
"use client";

import { FeaturePage } from "@/components/features/feature-page";
import { PageShell } from "@/components/layout/page-shell";
import { formatMinor, formatReceiptDate } from "@/lib/finance-format";
import { useLedger } from "@/lib/use-ledger";

export default function SubscriptionsPage() {
  const { report } = useLedger();
  const payments = report.rows.filter((row) => row.category === "Subscriptions" && row.amountMinor < 0);
  const total = payments.reduce((sum, row) => sum - row.amountMinor, 0);

  return (
    <PageShell>
      <FeaturePage title="Subscriptions" description="Review expenses you’ve categorized as Subscriptions."
        cards={[{ title: "Spent overall", value: formatMinor(total), note: "Recorded subscription payments" }]}>
        <section className="rounded-2xl border border-[#e4e9e2] bg-white p-5">
          <h2 className="font-semibold">Recorded payments</h2>
          {payments.length ? (
            <ul className="mt-2 divide-y divide-[#edf0ec]">
              {payments.map((row) => (
                <li className="flex justify-between gap-3 py-3 text-sm" key={row.id}>
                  <span>{row.name}<span className="block text-xs text-[#59685e]">{formatReceiptDate(row.date)}</span></span>
                  <span className="shrink-0 tabular-nums">{formatMinor(-row.amountMinor)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-[#59685e]">Choose Subscriptions when adding an expense to see it here.</p>}
        </section>
      </FeaturePage>
    </PageShell>
  );
}
