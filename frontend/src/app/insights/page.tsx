"use client";


import { FeaturePage } from "@/components/features/feature-page";
import { PageShell } from "@/components/layout/page-shell";
import { CategoryChart, MonthlyChart } from "@/components/dashboard/finance-charts";
import { useLedger } from "@/lib/use-ledger";

export default function InsightsPage() {
  const { report } = useLedger();
  return (
    <PageShell>
      <FeaturePage title="Insights" description="Compare monthly spending and see which categories account for the most." primaryAction="Ask oopsie AI" subtitle={report.range} cards={report.cards}>
        <div className="grid gap-4 xl:grid-cols-2">
          <MonthlyChart data={report.chart} />
          <CategoryChart categories={report.categories()} period="Current period" />
        </div>
      </FeaturePage>
    </PageShell>
  );
}
