"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { accountRequest, useAccount } from "@/components/account/account-provider";
import { FeaturePage } from "@/components/features/feature-page";
import { PlanningTabs, Progress } from "@/components/features/planning-page";
import { Modal } from "@/components/layout/modal";
import { formatMinor, formatReceiptDate } from "@/lib/finance-format";
import { amountsByGoal } from "@/lib/goal-savings";
import { expenseCategories, isDate, parseAmount } from "@/lib/ledger";
import type { Goal } from "@/lib/local-planning";
import { newReceiptId } from "@/lib/receipts";
import { localToday } from "@/lib/use-ledger";

type Fund = Goal & {
  fund_cadence: "weekly" | "monthly"; fund_amount_minor: number; fund_starts_on: string;
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

  return <FeaturePage title="Bill funds" description="Set money aside for future bills, like car registration or annual insurance."
    cards={[]} action={<button className={primary} disabled={!funds || Boolean(error)} onClick={() => setEditor({ kind: "edit" })}>Add bill fund</button>}>
    <PlanningTabs active="bill-funds" />
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#edf4ed] p-3 text-xs text-[#31533c]">
      <p>Oopsie tracks what you set aside. You move and pay the money yourself.</p>
      <Link href="/subscriptions" className="font-semibold underline">View subscriptions</Link>
    </div>
    {error ? <p role="alert" className="text-sm text-red-800">{error}
      <button type="button" className="ml-2 min-h-11 font-semibold underline" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Retry</button>
    </p> : !funds ? <p role="status" className="text-sm">Loading bill funds…</p> : funds.length === 0 ?
      <p className="rounded-xl border border-[#e4e9e2] bg-white p-4 text-sm">Add a bill fund and pick how much to set aside each week or month.</p> :
      <ul className="grid gap-3 sm:grid-cols-2">{[...funds].sort((a, b) => a.fund_next_due.localeCompare(b.fund_next_due) || a.name.localeCompare(b.name)).map((fund) => {
        const balance = saved(fund);
        return <li key={fund.id} className="rounded-2xl border border-[#e4e9e2] bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><h2 className="wrap-break-word font-semibold">{fund.name}</h2>
              <p className="mt-1 text-xs text-[#59685e]">{formatMinor(fund.fund_amount_minor)} {fund.fund_cadence} · {fund.priority ?? "normal"} priority</p></div>
            <button type="button" className={secondary} aria-label={"Edit " + fund.name} onClick={() => setEditor({ kind: "edit", fund })}>Edit</button>
          </div>
          <Progress goal amount={balance} target={fund.amount_minor} label="Set aside" status={balance >= fund.amount_minor ? "Fully funded" :
            !fund.fund_active ? "Paused" : fund.fund_next_due <= localToday() ? "Waiting for available money" : "Next contribution " + formatReceiptDate(fund.fund_next_due)} />
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
      const target = parseAmount(String(data.get("target") ?? ""));
      const contribution = parseAmount(String(data.get("contribution") ?? ""));
      const start = String(data.get("start") ?? "");
      if (!name || !target || !contribution || !isDate(start)) return setError("Check the fund name, amounts, and first contribution date.");
      payload = { name, amount_minor: target, saved_minor: fund?.saved_minor ?? 0, priority: data.get("priority"),
        fund_amount_minor: contribution, fund_cadence: data.get("repeat"), fund_starts_on: start, fund_active: data.has("active") };
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
            <label className="font-medium">Target amount (€)<input className={field} name="target" inputMode="decimal" required defaultValue={fund && (fund.amount_minor / 100).toFixed(2)} /></label>
            <label className="font-medium">Set aside (€)<input className={field} name="contribution" inputMode="decimal" required defaultValue={fund && (fund.fund_amount_minor / 100).toFixed(2)} /></label>
            <label className="font-medium">Repeat<select className={field} name="repeat" defaultValue={fund?.fund_cadence ?? "monthly"}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
            <label className="min-w-0 font-medium">First contribution<input type="date" className={field} name="start" required min="1900-01-01" max="9999-01-01" defaultValue={fund?.fund_starts_on ?? localToday()} /></label>
          </div>
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
