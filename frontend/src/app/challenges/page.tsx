import { PageShell } from "@/components/layout/page-shell";
import { Icon } from "@/components/layout/icon";

export default function ChallengesPage() {
  return (
    <PageShell>
      <div className="mx-auto max-w-4xl space-y-5">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#59685e]">Preview · Coming later</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Savings challenges</h1>
          <p className="mt-2 text-sm text-[#59685e]">Build a small savings habit with people you invite.</p>
        </header>
        <section className="rounded-2xl bg-[#183c31] p-6 text-white">
          <Icon name="target" className="size-7 text-[#d8ee79]" />
          <h2 className="mt-3 text-xl font-semibold">Four-week savings streak</h2>
          <p className="mt-2 max-w-md text-sm text-[#d3e1d9]">Pick a weekly goal that fits your budget. Check in each week your group takes a step toward its goals.</p>
          <ol className="mt-4 grid grid-cols-4 gap-2" aria-label="Example challenge progress">
            {[1, 2, 3, 4].map((week) => <li key={week} className={"rounded-xl p-2 text-center text-xs " + (week <= 2 ? "bg-[#d8ee79] text-[#183c31]" : "bg-white/10")}>Week {week}{week <= 2 && <span className="block">✓</span>}</li>)}
          </ol>
        </section>
        <section className="rounded-2xl border border-[#e4e9e2] bg-white p-5">
          <h2 className="font-semibold">What your group would see</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[#59685e]">
            <li>Invite-only groups. Each person chooses whether to join and can leave at any time.</li>
            <li>Share check-ins or milestones. Your amounts, income, and transactions stay private.</li>
            <li>Celebrate consistency together, with optional pause weeks and no rankings by money saved.</li>
          </ul>
        </section>
      </div>
    </PageShell>
  );
}
