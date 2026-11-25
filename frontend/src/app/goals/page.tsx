
import { FeaturePage } from "@/components/features/feature-page";
import { PageShell } from "@/components/layout/page-shell";

export default function GoalsPage() {
  return (
    <PageShell>
      <FeaturePage title="Savings goals" description="Set money aside for something you want to work toward." cards={[]}>
        <section className="rounded-2xl border border-[#e4e9e2] bg-white p-5">
          <h2 className="font-semibold">Goals are coming later</h2>
          <p className="mt-2 text-sm text-[#59685e]">You can already track the money you have left this period in Overview.</p>
        </section>
      </FeaturePage>
    </PageShell>
  );
}
