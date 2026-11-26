"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/layout/icon";
import { dismissModal, Modal } from "@/components/layout/modal";
import {
  periodComparisonAnswer, receiptHistoryAnswer, receiptHistoryMinimum, savingsAnswer, spendingReductionAnswer,
  spendingSummaryAnswer, type InsightAnswer,
} from "@/lib/guided-insights";
import { parseAmount } from "@/lib/ledger";
import type { Receipt } from "@/lib/receipts";
import type { useLedger } from "@/lib/use-ledger";

const prompts = [
  { id: "save", label: "Help me save for something", icon: "target" },
  { id: "reduce", label: "Help me spend less", icon: "arrow-down" },
  { id: "summary", label: "Analyze my spending", icon: "pie" },
  { id: "compare", label: "Compare with last period", icon: "arrows" },
  { id: "receipts", label: "What do my receipts show?", icon: "cart" },
] as const satisfies { id: string; label: string; icon: IconName }[];

type Topic = (typeof prompts)[number]["id"];
type Props = {
  report: ReturnType<typeof useLedger>["report"];
  today: string;
  records?: Receipt[];
  receiptError?: string;
  retryReceipts: () => void;
};

const field = "mt-1 min-h-11 w-full rounded-xl border border-[#dce4d9] bg-white px-3 text-base";
const action = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#183c31] px-4 text-sm font-semibold text-white";

export function GuidedInsights(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={action} onClick={() => setOpen(true)}>
        <Icon name="sparkles" className="size-4 text-[#d8ee79]" /> Ask Oopsie AI
      </button>
      {open && <GuidedDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function GuidedDialog({ report, today, records, receiptError, retryReceipts, onClose }: Props & { onClose: () => void }) {
  const titleId = useId();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [answer, setAnswer] = useState<InsightAnswer | null>(null);
  const [goal, setGoal] = useState("");
  const [periods, setPeriods] = useState(3);
  const [category, setCategory] = useState("");
  const [previous, setPrevious] = useState(false);
  const [error, setError] = useState("");
  const categories = report.categories();
  const selectedCategory = categories.find(({ label }) => label === category) ?? categories[0];
  const receiptCount = records?.length ?? 0;

  function choose(next: Topic | null) {
    setTopic(next);
    setError("");
    setAnswer(next === "compare" ? periodComparisonAnswer(report, today) : null);
  }

  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (topic === "save") {
      const amount = parseAmount(goal);
      if (amount === null) {
        setError("Enter a positive amount with up to two decimal places.");
        return;
      }
      setAnswer(savingsAnswer(amount, periods, report.current));
    }
    if (topic === "reduce" && selectedCategory) setAnswer(spendingReductionAnswer(selectedCategory.label, selectedCategory.amount));
    if (topic === "summary") setAnswer(spendingSummaryAnswer(report, previous));
  }

  return (
    <Modal titleId={titleId} placement="sheet" onClose={onClose}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#eaf1e7] text-[#31533c]"><Icon name="sparkles" className="size-5" /></span>
          <div>
            <h2 id={titleId} className="font-semibold">Oopsie AI</h2>
            <p className="text-xs text-[#59685e]">Guided answers from your records</p>
          </div>
        </div>
        <button type="button" onClick={dismissModal} className="min-h-11 px-2 text-sm font-semibold text-[#31533c]">Close</button>
      </header>
      {topic === null ? (
        <ul className="mt-4 space-y-2">
          {prompts.map(({ id, label, icon }) => (
            <li key={id}>
              <button type="button" onClick={() => choose(id)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-[#e4e9e2] px-3 py-2 text-left text-sm font-semibold hover:bg-[#f3f6ef]">
                <Icon name={icon} className="size-4 shrink-0 text-[#31533c]" />
                <span className="flex-1">{label}</span>
                <Icon name="chevron" className="size-4 shrink-0 text-[#59685e]" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 space-y-3">
          <button type="button" onClick={() => choose(null)} className="min-h-11 text-sm font-semibold text-[#31533c]">← All questions</button>
          <h3 className="font-semibold">{prompts.find(({ id }) => id === topic)?.label}</h3>
          {topic === "receipts" ? (
            receiptError ? <p role="alert" className="text-sm">{receiptError} <button onClick={retryReceipts} className="underline">Retry</button></p>
              : !records ? <p role="status" className="text-sm">Loading receipts…</p>
              : receiptCount < receiptHistoryMinimum ? (
                <div className="space-y-2">
                  <p className="text-sm text-[#59685e]">Unlock this answer with {receiptHistoryMinimum} saved receipts.</p>
                  <progress className="h-2 w-full accent-[#31533c]" value={receiptCount} max={receiptHistoryMinimum} aria-label="Saved receipts toward unlock" />
                  <p className="text-xs font-semibold text-[#31533c]">{receiptCount} of {receiptHistoryMinimum} receipts saved</p>
                  <Link href="/receipts/new" className={action}>Scan a receipt</Link>
                </div>
              ) : <Answer answer={receiptHistoryAnswer(records)} />
          ) : topic === "reduce" && !selectedCategory ? (
            <p className="text-sm text-[#59685e]">Log an expense in this reporting period to try a spending target.</p>
          ) : topic !== "compare" && (
            <form onSubmit={calculate} className="space-y-3">
              {topic === "save" && <>
                <label className="block text-sm font-medium">Savings target (€)
                  <input className={field} inputMode="decimal" required value={goal} onChange={(event) => { setGoal(event.target.value); setAnswer(null); setError(""); }} />
                </label>
                <label className="block text-sm font-medium">Number of reporting periods
                  <select className={field} value={periods} onChange={(event) => { setPeriods(Number(event.target.value)); setAnswer(null); }}>
                    {[1, 3, 6, 12].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
              </>}
              {topic === "reduce" && <label className="block text-sm font-medium">Category to focus on
                <select className={field} value={selectedCategory?.label} onChange={(event) => { setCategory(event.target.value); setAnswer(null); }}>
                  {categories.map(({ label }) => <option key={label} value={label}>{label}</option>)}
                </select>
              </label>}
              {topic === "summary" && <label className="block text-sm font-medium">Reporting period
                <select className={field} value={previous ? "previous" : "current"} onChange={(event) => { setPrevious(event.target.value === "previous"); setAnswer(null); }}>
                  <option value="current">This period</option>
                  <option value="previous">Last period</option>
                </select>
              </label>}
              <button type="submit" className={action}>Show answer</button>
              {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
            </form>
          )}
          {answer && <Answer answer={answer} />}
        </div>
      )}
    </Modal>
  );
}

function Answer({ answer }: { answer: InsightAnswer }) {
  return (
    <section role="status" className="rounded-xl border border-[#dce4d9] bg-[#f3f6ef] p-3">
      <h4 className="font-semibold">{answer.title}</h4>
      <p className="mt-1 break-words text-sm text-[#46564a]">{answer.detail}</p>
      {answer.facts && <dl className="mt-2 divide-y divide-[#dce4d9] text-sm">
        {answer.facts.map(({ label, value }) => <div key={label} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 py-2">
          <dt className="min-w-0 break-words">{label}</dt><dd className="min-w-0 break-words font-semibold tabular-nums">{value}</dd>
        </div>)}
      </dl>}
    </section>
  );
}
