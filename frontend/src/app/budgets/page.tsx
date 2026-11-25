
"use client";

import { CategoryChart } from "@/components/dashboard/finance-charts";
import { FeaturePage } from "@/components/features/feature-page";
import { PageShell } from "@/components/layout/page-shell";
import { useLedger } from "@/lib/use-ledger";

export default function BudgetsPage() {
  const { report } = useLedger();
  return (
    <PageShell>
      <FeaturePage title="Budgets" description="Review what you spend by category. Setting budget limits is coming later."
        subtitle={report.range} cards={[]}>
        <CategoryChart categories={report.categories()} period="Current period" />
      </FeaturePage>
    </PageShell>
  );
}
