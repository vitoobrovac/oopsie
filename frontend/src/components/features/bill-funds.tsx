"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { accountRequest, useAccount } from "@/components/account/account-provider";
import { FeaturePage } from "@/components/features/feature-page";
import { PlanningTabs, Progress } from "@/components/features/planning-page";
import { Modal } from "@/components/layout/modal";
import { formatMinor, formatReceiptDate } from "@/lib/finance-format";
import { amountsByGoal } from "@/lib/goal-savings";
import { firstFundingDate, fundingPlan, type FundCadence } from "@/lib/bill-fund-schedule";
import { expenseCategories, isDate, parseAmount } from "@/lib/ledger";
import type { Goal } from "@/lib/local-planning";
import { newReceiptId } from "@/lib/receipts";
import { localToday } from "@/lib/use-ledger";

type Fund = Goal & {
  fund_cadence: FundCadence; fund_amount_minor: number | null; fund_due_on?: string | null; fund_starts_on: string;
  fund_next_due: string; fund_active: boolean;
};
type Editor = { kind: "edit"; fund?: Fund } | { kind: "bill" | "delete"; fund: Fund };
const primary = "min-h-11 rounded-xl bg-[#183c31] px-4 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "min-h-11 rounded-xl border border-[#dce4d9] px-3 text-sm font-semibold text-[#31533c] disabled:opacity-50";
const field = "mt-1 min-h-11 w-full rounded-xl border border-[#dce4d9] bg-white px-3 text-base";
const path = "planning/bill-funds";

export function BillFunds() {
  const { session, remote, refreshLedger, ledgerRevision } = useAccount();
  const [funds, setFunds] = useState<Fund[]>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const allocations = amountsByGoal(remote?.data?.goalAllocations ?? []);
  function saved(fund: Fund) {
    return fund.saved_minor + (allocations.get(fund.id) ?? 0);
  }

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    void accountRequest<Fund[]>(session, path, { signal: controller.signal }).then(
      (records) => { if (!controller.signal.aborted) { setFunds(records); setError(""); } },
      (reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load bill funds."); },
    );
    return () => controller.abort();
  }, [session, attempt, ledgerRevision]);

  async function commit(current: Editor, payload?: object) {
    if (!session) throw new Error("Sign in to manage bill funds.");
    const id = current.fund?.id;
    if (current.kind === "delete") {
      await accountRequest(session, path + "/" + id, { method: "DELETE" });
      setFunds((records) => records?.filter((record) => record.id !== id));
    } else if (current.kind === "bill") {
      await accountRequest(session, "bill-funds/" + id + "/record-bill", { method: "POST", body: JSON.stringify(payload) });
    } else {
      const record = await accountRequest<Fund>(session, id ? path + "/" + id : path,
        { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
      setFunds((records) => [...(records ?? []).filter((fund) => fund.id !== record.id), record]);
    }
    setEditor(null);
    refreshLedger();
    setAttempt((value) => value + 1);
  }

  return <FeaturePage title="Bill funds" description="Reserve money weekly or monthly for a future bill or loan payment. Pick a due date and Oopsie adjusts the contributions as you save."
    cards={[]} action={<button className={primary} disabled={!funds || Boolean(error)} onClick={() => setEditor({ kind: "edit" })}>Add bill fund</button>}>
    <PlanningTabs active="bill-funds" />
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#edf4ed] p-3 text-xs text-[#31533c]">
      <p>Oopsie tracks what you set aside. You move and pay the money yourself.</p>
      <Link href="/" className="font-semibold underline">Add spare money from Overview</Link>
    </div>
    {error ? <p role="alert" className="text-sm text-red-800">{error}
      <button type="button" className="ml-2 min-h-11 font-semibold underline" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Retry</button>
    </p> : !funds ? <p role="status" className="text-sm">Loading bill funds…</p> : funds.length === 0 ?
      <p className="rounded-xl border border-[#e4e9e2] bg-white p-4 text-sm">Add a fund for car registration, annual insurance, or another planned payment.</p> :
      <ul className="grid gap-3 sm:grid-cols-2">{[...funds].sort((a, b) => a.fund_next_due.localeCompare(b.fund_next_due) || a.name.localeCompare(b.name)).map((fund) => {
        const balance = saved(fund);
        const today = localToday();
        const plan = fund.fund_due_on
          ? fundingPlan(fund.fund_starts_on, fund.fund_cadence, fund.fund_next_due, today, fund.fund_due_on, fund.amount_minor - balance) : null;
        const contribution = plan?.amount ?? fund.fund_amount_minor ?? 0;
        const status = balance >= fund.amount_minor ? "Fully funded" : !fund.fund_active ? "Paused"
          : fund.fund_due_on && fund.fund_due_on < today ? "Deadline passed"
          : plan?.count === 0 ? "No contributions scheduled before the deadline"
          : fund.fund_next_due <= today ? "Waiting for available money" : "Next contribution " + formatReceiptDate(fund.fund_next_due);
        return <li key={fund.id} className="rounded-2xl border border-[#e4e9e2] bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><h2 className="wrap-break-word font-semibold">{fund.name}</h2>
              <p className="mt-1 text-xs text-[#59685e]">{!plan || contribution > 0 ? formatMinor(contribution) + " " + fund.fund_cadence + " · " : ""}{fund.priority ?? "normal"} priority</p>
              {fund.fund_due_on && <p className="mt-1 text-xs text-[#59685e]">Due {formatReceiptDate(fund.fund_due_on)}</p>}</div>
            <button type="button" className={secondary} aria-label={"Edit " + fund.name} onClick={() => setEditor({ kind: "edit", fund })}>Edit</button>
          </div>
          <Progress goal amount={balance} target={fund.amount_minor} label="Set aside" status={status} />
          {balance > 0 && <button type="button" className={secondary + " mt-3"} onClick={() => setEditor({ kind: "bill", fund })}>Record bill</button>}
        </li>;
      })}</ul>}
    {editor && <FundForm key={editor.kind} editor={editor} balance={editor.fund ? saved(editor.fund) : 0}
      close={() => setEditor(null)} remove={(fund) => setEditor({ kind: "delete", fund })} commit={commit} />}
  </FeaturePage>;
}

function FundForm({ editor, balance, close, remove, commit }: {
  editor: Editor; balance: number; close: () => void; remove: (fund: Fund) => void;
  commit: (editor: Editor, payload?: object) => Promise<void>;
}) {
  const { kind, fund } = editor;
  const title = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [billText, setBillText] = useState("");
  const [entryId] = useState(newReceiptId);
  const [mode, setMode] = useState(fund && !fund.fund_due_on ? "fixed" : "deadline");
  const [targetText, setTargetText] = useState(fund ? (fund.amount_minor / 100).toFixed(2) : "");
  const [savedText, setSavedText] = useState(fund ? (fund.saved_minor / 100).toFixed(2) : "");
  const [cadence, setCadence] = useState<FundCadence>(fund?.fund_cadence ?? "monthly");
  const today = localToday();
  const [start, setStart] = useState(fund?.fund_starts_on ?? today);
  const [deadline, setDeadline] = useState(fund?.fund_due_on ?? "");
  const target = parseAmount(targetText);
  const alreadySaved = !savedText.trim() || /^0+(?:[.,]0{1,2})?$/.test(savedText.trim()) ? 0 : parseAmount(savedText);
  const remaining = Math.max(0, (target ?? 0) - (alreadySaved ?? 0) - (balance - (fund?.saved_minor ?? 0)));
  const projection = mode === "deadline" && target && alreadySaved !== null && isDate(start) && isDate(deadline)
    ? fundingPlan(start, cadence, fund?.fund_starts_on === start && fund.fund_cadence === cadence
      ? fund.fund_next_due : firstFundingDate(start, cadence, today), today, deadline, remaining) : null;
  const bill = parseAmount(billText);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    let payload: object | undefined;
    if (kind === "bill") {
      if (!bill || !name) return setError("Enter a description and a positive bill amount.");
      payload = { entry_id: entryId, amount_minor: bill, description: name, category: data.get("category") };
    }
    if (kind === "edit") {
      const contribution = parseAmount(String(data.get("contribution") ?? ""));
      if (!name || !target || alreadySaved === null || !isDate(start)) return setError("Check the fund name, amounts, and first contribution date.");
      if (mode === "fixed" && !contribution) return setError("Enter a positive contribution amount.");
      if (mode === "deadline" && (!isDate(deadline) || deadline < start || (!fund && !projection?.count))) {
        return setError("Choose a deadline with at least one contribution on or before it.");
      }
      payload = { name, amount_minor: target, saved_minor: alreadySaved, priority: data.get("priority"),
        fund_amount_minor: mode === "fixed" ? contribution : null, fund_due_on: mode === "deadline" ? deadline : null,
        fund_cadence: cadence, fund_starts_on: start, fund_active: data.has("active") };
    }
    setError("");
    setPending(true);
    try {
      await commit(editor, payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this update.");
      setPending(false);
    }
  }

  return <Modal titleId={title} onClose={close} pending={pending} placement="sheet">
    <h2 id={title} className="text-lg font-semibold">{kind === "bill" ? "Record bill" : kind === "delete" ? "Delete bill fund?" : fund ? "Edit bill fund" : "Add bill fund"}</h2>
    <form onSubmit={save} className="mt-3 space-y-3 text-sm">
      {kind === "delete" ? <p className="text-[#59685e]">Recorded bills will stay in Activity. The amounts set aside for this fund will be released in your reports.</p> : <>
        <label className="block font-medium">{kind === "bill" ? "Description" : "Fund name"}
          <input name="name" required maxLength={120} className={field} defaultValue={fund?.name} placeholder="e.g. Car registration" />
        </label>
        {kind === "bill" ? <>
          <label className="block font-medium">Bill amount (€)
            <input name="bill" className={field} inputMode="decimal" required value={billText} onChange={(event) => setBillText(event.target.value)} />
          </label>
          <label className="block font-medium">Spending category
            <select name="category" className={field} defaultValue="Other">
              {expenseCategories.map(([label, value]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <p className="rounded-xl bg-[#edf4ed] p-3 text-xs text-[#31533c]">{formatMinor(balance)} set aside. {bill ?
            formatMinor(Math.min(balance, bill)) + " will come from the fund in Oopsie." : "The bill will be recorded as today’s expense."}
            {bill && bill > balance ? " The remaining " + formatMinor(bill - balance) + " comes from your available balance." : ""}</p>
        </> : <>
          <div className="grid grid-cols-2 gap-2">
            <label className="font-medium">Target amount (€)<input className={field} inputMode="decimal" required value={targetText} onChange={(event) => setTargetText(event.target.value)} /></label>
            <label className="font-medium">Already saved (€)<input className={field} inputMode="decimal" placeholder="0.00" value={savedText} onChange={(event) => setSavedText(event.target.value)} /></label>
            <label className="font-medium">Repeat<select className={field} value={cadence} onChange={(event) => setCadence(event.target.value as FundCadence)}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
            <label className="min-w-0 font-medium">First contribution<input type="date" className={field} required min={fund?.fund_starts_on ?? today} max="9999-01-01" value={start} onChange={(event) => setStart(event.target.value)} /></label>
          </div>
          <p className="text-xs text-[#59685e]">Already saved tracks money set aside outside Oopsie. It doesn’t reduce what’s left in your ledger.</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="font-medium">Plan by<select className={field} value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="deadline">Due date</option><option value="fixed">Fixed amount</option>
            </select></label>
            {mode === "deadline" ? <label className="min-w-0 font-medium">Due date
              <input type="date" className={field} required min={start} max="9999-01-01" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
            </label> : <label className="font-medium">Set aside (€)
              <input className={field} name="contribution" inputMode="decimal" required defaultValue={fund?.fund_amount_minor ? (fund.fund_amount_minor / 100).toFixed(2) : ""} />
            </label>}
          </div>
          {projection && <p className="rounded-xl bg-[#edf4ed] p-3 text-sm text-[#31533c]">
            {!remaining ? "Target already funded." : projection.count ? <>
              <strong>{formatMinor(projection.amount)} {cadence}</strong> · {projection.count} {projection.count === 1 ? "contribution" : "contributions"} left.
              <span className="mt-1 block text-xs">Adding money early lowers the remaining contributions.</span>
            </> : "No scheduled contributions fit before this deadline."}
          </p>}
          <label className="block font-medium">Priority<select name="priority" className={field} defaultValue={fund?.priority ?? "normal"}>
            <option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
          </select></label>
          <label className="flex min-h-10 items-center gap-2"><input type="checkbox" name="active" defaultChecked={fund?.fund_active ?? true} />Automatically set money aside</label>
          <p className="text-xs text-[#59685e]">Oopsie waits until there’s enough left in the current period and stops contributing when the fund reaches its target.</p>
        </>}
      </>}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {kind === "edit" && fund && <button type="button" disabled={pending} className="mr-auto min-h-11 text-sm font-semibold text-red-800" onClick={() => remove(fund)}>Delete</button>}
        <button type="button" disabled={pending} className={secondary} onClick={close}>Cancel</button>
        <button disabled={pending} className={kind === "delete" ? primary.replace("bg-[#183c31]", "bg-red-800") : primary}>
          {pending ? "Saving…" : kind === "bill" ? "Record bill" : kind === "delete" ? "Delete fund" : "Save fund"}
        </button>
      </div>
    </form>
  </Modal>;
}
