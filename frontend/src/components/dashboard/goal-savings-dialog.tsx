"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { accountRequest, useAccount } from "@/components/account/account-provider";
import { Modal } from "@/components/layout/modal";
import { formatMinor } from "@/lib/finance-format";
import { availableGoals, suggestSplit, type GoalAllocation, type SavingsPeriod } from "@/lib/goal-savings";
import { parseAmount } from "@/lib/ledger";
import { useLocalPlanning, type Goal } from "@/lib/local-planning";
import { newReceiptId } from "@/lib/receipts";

const field = "mt-1 min-h-11 w-full rounded-xl border border-[#dce4d9] bg-white px-3 text-base";

export function GoalSavingsDialog({ balance, period, allocations, onClose, onSaved }: {
  balance: number; period: SavingsPeriod; allocations?: GoalAllocation[];
  onClose: () => void; onSaved: (amount: number) => void;
}) {
  const { session, refreshLedger } = useAccount();
  const title = useId();
  const [goals, setGoals] = useState<Goal[]>();
  const [goalError, setGoalError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState("amount");
  const [value, setValue] = useState("");
  const [destination, setDestination] = useState("split");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const attemptId = useRef<{ key: string; id: string } | null>(null);
  const ready = allocations !== undefined && !useLocalPlanning;

  useEffect(() => {
    if (!session || !ready) return;
    const controller = new AbortController();
    void accountRequest<Goal[]>(session, "planning/goals", { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) { setGoals(data); setGoalError(""); } },
      (reason: unknown) => { if (!controller.signal.aborted) setGoalError(reason instanceof Error ? reason.message : "Could not load savings goals."); },
    );
    return () => controller.abort();
  }, [session, attempt, ready]);

  const openGoals = availableGoals(goals ?? [], allocations ?? []);
  const eligible = destination === "split" ? openGoals : openGoals.filter((goal) => goal.id === destination);
  const percent = /^\d{1,3}$/.test(value) ? Number(value) : 0;
  const amount = mode === "all" ? balance : mode === "percent"
    ? percent >= 1 && percent <= 100 ? Math.floor(balance * percent / 100) : 0
    : parseAmount(value) ?? 0;
  const parts = amount > 0 && amount <= balance ? suggestSplit(eligible, amount) : [];
  const allocated = parts.reduce((sum, part) => sum + part.amount_minor, 0);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || busy || allocated <= 0) return;
    const contributions = parts.map(({ goal, amount_minor }) => ({ goal_id: goal.id, amount_minor }));
    const payload = { period, contributions };
    const key = JSON.stringify(payload);
    if (attemptId.current?.key !== key) attemptId.current = { key, id: newReceiptId() };
    setBusy(true);
    setError("");
    try {
      await accountRequest(session, "goals/allocate", { method: "POST", body: JSON.stringify({
        ...payload, allocation_id: attemptId.current.id,
      }) });
      refreshLedger();
      onSaved(allocated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record these savings.");
      setBusy(false);
    }
  }

  return <Modal titleId={title} onClose={onClose} pending={busy} placement="sheet">
    <h2 id={title} className="text-lg font-semibold">Put into goal savings</h2>
    <p className="mt-1 text-sm text-[#31533c]"><strong>{formatMinor(balance)}</strong> left this {period}</p>
    <p className="mt-3 rounded-xl bg-[#edf4ed] p-3 text-xs text-[#31533c]">Oopsie only tracks this amount. Move the money to your savings yourself.</p>
    {!ready ? <p role="status" className="mt-3 text-sm text-[#59685e]">{useLocalPlanning
      ? "Switch from browser preview to account storage to save goal contributions."
      : "Goal savings needs Supabase migration 015 and the current API. After setup, reload Overview."}</p>
    : goalError ? <p role="alert" className="mt-3 text-sm text-red-800">{goalError}
      <button type="button" className="ml-2 min-h-10 underline" onClick={() => { setGoalError(""); setAttempt((count) => count + 1); }}>Retry</button>
    </p> : !goals ? <p role="status" className="mt-3 text-sm">Loading goals…</p> : !openGoals.length ? (
      <div className="mt-4 space-y-2 text-sm">
        <p>Create a savings goal with a target to get started.</p>
        <Link href="/goals" className="inline-flex min-h-11 items-center font-semibold text-[#31533c] underline">Go to savings goals</Link>
      </div>
    ) : <form onSubmit={save} className="mt-4 space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <label className="font-medium">Set aside
          <select className={field} value={mode} disabled={busy} onChange={(event) => { setMode(event.target.value); setValue(""); }}>
            <option value="amount">Part of it</option><option value="all">All of it</option><option value="percent">A percentage</option>
          </select>
        </label>
        {mode !== "all" && <label className="font-medium">{mode === "percent" ? "Percent (%)" : "Amount (€)"}
          <input value={value} className={field} disabled={busy} inputMode={mode === "percent" ? "numeric" : "decimal"} required
            onChange={(event) => setValue(event.target.value)} />
        </label>}
      </div>
      <label className="block font-medium">Put into
        <select className={field} disabled={busy} value={destination} onChange={(event) => setDestination(event.target.value)}>
          <option value="split">Suggest a split</option>
          {openGoals.map((goal) => <option key={goal.id} value={goal.id}>{goal.name}{goal.fund_cadence ? " · Bill fund" : ""}</option>)}
        </select>
      </label>
      {destination === "split" && <p className="text-xs text-[#59685e]">The suggestion gives more to higher-priority goals and goals with more left to save.</p>}
      {amount > balance && <p className="text-xs text-red-800">Enter an amount within what’s left this {period}.</p>}
      {parts.length > 0 && <div className="rounded-xl border border-[#dce4d9] px-3">
        <ul className="max-h-36 divide-y divide-[#edf0ec] overflow-y-auto">{parts.map(({ goal, amount_minor }) => <li key={goal.id} className="flex justify-between gap-2 py-2">
          <span className="wrap-break-word">{goal.name}</span><strong className="shrink-0 tabular-nums">{formatMinor(amount_minor)}</strong>
        </li>)}</ul>
        <p className="border-t border-[#dce4d9] py-2 font-medium">New available balance · {formatMinor(balance - allocated)}</p>
      </div>}
      {amount > 0 && amount <= balance && allocated < amount && <p className="text-xs text-[#59685e]">{formatMinor(amount - allocated)} stays available because the selected goals have limited room.</p>}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <button type="submit" disabled={busy || !allocated}
        className="min-h-11 rounded-xl bg-[#183c31] px-4 font-semibold text-white disabled:opacity-50">
        {busy ? "Recording…" : "Record " + formatMinor(allocated) + " in savings"}
      </button>
    </form>}
    <button type="button" onClick={onClose} disabled={busy} className="mt-2 min-h-11 px-2 text-sm font-medium text-[#31533c]">Close</button>
  </Modal>;
}
