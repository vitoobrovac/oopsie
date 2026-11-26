"use client";

import { useEffect, useId, useState, type CSSProperties, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { accountRequest, useAccount } from "@/components/account/account-provider";
import { FeaturePage } from "@/components/features/feature-page";
import { dismissModal, Modal } from "@/components/layout/modal";
import { PageShell } from "@/components/layout/page-shell";
import { formatMinor, formatReceiptDate } from "@/lib/finance-format";
import { expenseCategories, isDate, parseAmount, yearlyExpenseCategory } from "@/lib/ledger";
import { localToday, useLedger } from "@/lib/use-ledger";

import { deleteLocalPlan, isYearlyCadence, listLocalPlans, saveLocalPlan, scheduledPayment, useLocalPlanning, type Budget, type Cadence, type Plan, type PlanItem as Item } from "@/lib/local-planning";

type Editor = { item?: Item; remove?: boolean };

const pages = {
  budgets: {
    title: "Budgets", item: "budget", action: "Add budget",
    description: "Set category limits for each reporting month.",
    empty: "Add a budget to see how much you have left to spend in that category.",
  },
  goals: {
    title: "Savings goals", item: "goal", action: "Add goal",
    description: "Set a target and record what you’ve put aside.",
    empty: "Add a savings goal for something you want to work toward.",
  },
  subscriptions: {
    title: "Subscriptions", item: "subscription", action: "Add subscription",
    description: "Automatically record weekly, monthly, or yearly expenses in your ledger.",
    empty: "Add a recurring expense and choose the date of your first payment.",
  },
};
const primary = "min-h-11 rounded-xl bg-[#183c31] px-4 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "min-h-11 rounded-xl border border-[#dce4d9] px-3 text-sm font-semibold text-[#31533c] disabled:opacity-50";
const field = "mt-1 min-h-11 w-full min-w-0 rounded-xl border border-[#dce4d9] bg-white px-3 py-2 text-base";

export function PlanningPage({ plan }: { plan: Plan }) {
  const { session } = useAccount();
  return <PageShell requiresLedger={!useLocalPlanning}>{session && <PlanningContent key={session.user.id + plan} session={session} plan={plan} />}</PageShell>;
}

function PlanningContent({ session, plan }: { session: Session; plan: Plan }) {
  const { report } = useLedger();
  const { refreshLedger, remote } = useAccount();
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const copy = pages[plan];
  const path = "planning/" + plan;
  const categoryLabels = new Map<string, string>(expenseCategories.map(([name, label]) => [name, label]));
  for (const row of report.rows) {
    if (row.amountMinor < 0 && !categoryLabels.has(row.category)) categoryLabels.set(row.category, row.category);
  }
  const spending = new Map<string, number>();
  for (const { label, amount } of report.categories()) {
    const key = label.trim().toLowerCase();
    spending.set(key, (spending.get(key) ?? 0) + amount);
  }
  const ordered = [...(items ?? [])].sort((a, b) => {
    if ("next_due" in a && "next_due" in b) return Number(b.active) - Number(a.active) || a.next_due.localeCompare(b.next_due);
    return itemName(a).localeCompare(itemName(b));
  });

  const groups = plan === "subscriptions" ? [
    { title: "Regular subscriptions", records: ordered.filter((item) => "cadence" in item && !isYearlyCadence(item.cadence)) },
    { title: yearlyExpenseCategory, records: ordered.filter((item) => "cadence" in item && isYearlyCadence(item.cadence)) },
  ] : [{ title: null, records: ordered }];
  const ItemHeading = plan === "subscriptions" ? "h3" : "h2";

  useEffect(() => {
    const controller = new AbortController();
    const pending = useLocalPlanning ? Promise.resolve().then(() => listLocalPlans(session.user.id, plan))
      : accountRequest<Item[]>(session, path, { signal: controller.signal });
    void pending.then(
      (records) => { if (!controller.signal.aborted) { setItems(records); setLoadError(""); } },
      (error: Error) => {
        if (controller.signal.aborted) return;
        setLoadError(error.message === "Not Found" ? "The API running here does not support planning yet. Restart it with the current backend." : error.message);
      },
    );
    return () => controller.abort();
  }, [session, plan, path, revision]);

  async function commit(payload?: object) {
    const id = editor?.item?.id;
    const target = id ? path + "/" + encodeURIComponent(id) : path;
    if (editor?.remove) {
      if (useLocalPlanning && id) deleteLocalPlan(session.user.id, plan, id);
      else await accountRequest(session, target, { method: "DELETE" });
      setItems((current) => current?.filter((item) => item.id !== id) ?? []);
    } else {
      if (!payload) return;
      const saved = useLocalPlanning ? saveLocalPlan(session.user.id, plan, payload, id)
        : await accountRequest<Item>(session, target, { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
      setItems((current) => [...(current ?? []).filter((item) => item.id !== saved.id), saved]);
    }
    setEditor(null);
    if (plan === "subscriptions") {
      refreshLedger();
      setRevision((value) => value + 1);
    }
  }

  return (
    <FeaturePage title={copy.title} description={copy.description} cards={[]}
      subtitle={plan === "budgets" ? report.range : undefined}
      action={<button className={primary} disabled={!items || Boolean(loadError)} onClick={() => setEditor({})}>{copy.action}</button>}>
      {useLocalPlanning && <p className="text-xs text-[#59685e]">Local preview · Changes are saved in this browser.{plan === "budgets" && !remote?.data ? " Spending totals appear when the ledger is connected." : ""}</p>}
      {loadError ? (
        <p role="alert" className="rounded-2xl border border-[#e4e9e2] bg-white p-4 text-sm">
          {loadError} <button className="ml-2 min-h-11 font-semibold underline" onClick={() => { setLoadError(""); setItems(null); setRevision(revision + 1); }}>Retry</button>
        </p>
      ) : !items ? <p role="status" className="text-sm text-[#59685e]">Loading…</p> : !ordered.length ? (
        <p className="rounded-2xl border border-[#e4e9e2] bg-white p-4 text-sm text-[#59685e]">{copy.empty}</p>
      ) : groups.filter(({ records }) => records.length).map(({ title, records }) => (
        <div key={title ?? plan}>
          {title && <h2 className="mb-2 text-sm font-semibold text-[#31533c]">{title}</h2>}
          <ul className="grid gap-3 sm:grid-cols-2">
            {records.map((item) => (
              <li key={item.id} className="min-w-0 rounded-2xl border border-[#e4e9e2] bg-white p-3 sm:p-4">
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <ItemHeading className="break-words font-semibold">{("category" in item && categoryLabels.get(item.category)) || itemName(item)}</ItemHeading>
                    {"next_due" in item && <p className="mt-1 text-sm text-[#59685e]">{formatMinor(item.amount_minor)} · {item.cadence === "yearly_split" ? "yearly, split into 12 entries" : item.cadence}</p>}
                  </div>
                  <button className={secondary} aria-label={"Edit " + itemName(item)} onClick={() => setEditor({ item })}>Edit</button>
                </div>
                {"category" in item ? <BudgetProgress item={item} spent={spending.get(item.category.trim().toLowerCase()) ?? 0} />
                  : "saved_minor" in item ? <Progress amount={item.saved_minor} target={item.amount_minor} label="Saved" goal
                      status={item.saved_minor >= item.amount_minor ? "Goal reached" : formatMinor(item.amount_minor - item.saved_minor) + " to go"} />
                  : <p className="mt-3 text-sm font-medium text-[#31533c]">{item.active ? "Next entry " + formatReceiptDate(item.next_due) + (item.cadence === "yearly_split" ? " · " + formatMinor(scheduledPayment(item)) : "") : "Paused"}</p>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {plan === "subscriptions" && <p className="text-xs text-[#59685e]">Scheduled entries track payments in oopsie. Your bill provider still handles the actual charge.</p>}
      {editor && <PlanForm key={editor.remove ? "delete" : "edit"} plan={plan} editor={editor} categories={categoryLabels} close={() => setEditor(null)} remove={() => setEditor({ item: editor.item, remove: true })} commit={commit} />}
    </FeaturePage>
  );
}

function itemName(item: Item) {
  return "category" in item ? item.category : item.name;
}

function BudgetProgress({ item, spent }: { item: Budget; spent: number }) {
  const remaining = item.amount_minor - spent;
  return <Progress amount={spent} target={item.amount_minor} label="Spent" status={formatMinor(Math.abs(remaining)) + (remaining < 0 ? " over budget" : " left")} />;
}

function Progress({ amount, target, label, status, goal = false }: { amount: number; target: number; label: string; status: string; goal?: boolean }) {
  const progress = Math.min(amount / target, 1);
  const green = goal ? progress : 1 - progress;
  const hue = green < 0.5 ? green * 86 : 43 + (green - 0.5) * 202;
  const color = { "--progress-color": "hsl(" + hue + " 62% 38%)" } as CSSProperties;
  return (
    <div className="mt-3 space-y-1 text-sm">
      <p className="tabular-nums">{label} {formatMinor(amount)} of {formatMinor(target)}</p>
      <progress aria-label={label} value={Math.min(amount, target)} max={target} style={color} className="block h-2 w-full overflow-hidden rounded-full bg-[#edf1eb] accent-[var(--progress-color)] [&::-webkit-progress-bar]:bg-[#edf1eb] [&::-webkit-progress-value]:bg-[var(--progress-color)] [&::-moz-progress-bar]:bg-[var(--progress-color)]" />
      <p className="text-xs font-medium text-[#59685e]">{status}</p>
    </div>
  );
}

function PlanForm({ plan, editor, categories, close, remove, commit }: {
  plan: Plan; editor: Editor; categories: Map<string, string>; close: () => void;
  remove: () => void; commit: (payload?: object) => Promise<void>;
}) {
  const { item, remove: deleting } = editor;
  const copy = pages[plan];
  const titleId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [firstDate, setFirstDate] = useState(item && "starts_on" in item ? item.starts_on : localToday());
  const defaultCategory = item && "category" in item ? item.category : "";
  const [cadence, setCadence] = useState<Cadence>(item && "cadence" in item ? item.cadence : "monthly");
  const [amountText, setAmountText] = useState(item ? (item.amount_minor / 100).toFixed(2) : "");
  const yearly = isYearlyCadence(cadence);
  const amountLabel = { budgets: "Monthly limit (€)", goals: "Target amount (€)", subscriptions: yearly ? "Yearly amount (€)" : "Payment amount (€)" }[plan];
  const amount = parseAmount(amountText);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const values = new FormData(event.currentTarget);
    const saved = String(values.get("saved") ?? "").trim();
    const savedMinor = !saved || /^0+(?:[.,]0{1,2})?$/.test(saved) ? 0 : parseAmount(saved);
    setError("");
    if (!deleting && (amount === null || savedMinor === null || (plan === "subscriptions" && !isDate(firstDate)))) {
      setError("Check your amounts and date. Use up to two decimal places.");
      return;
    }
    if (!deleting && plan === "subscriptions" && cadence === "yearly_split" && (amount ?? 0) < 12) {
      setError("Enter at least €0.12 to split the yearly amount across 12 months.");
      return;
    }
    const payload = {
      budgets: { category: values.get("category"), amount_minor: amount },
      goals: { name: values.get("name"), amount_minor: amount, saved_minor: savedMinor },
      subscriptions: { name: values.get("name"), amount_minor: amount, starts_on: firstDate, cadence, active: values.has("active") },
    }[plan];
    setPending(true);
    try {
      await commit(deleting ? undefined : payload);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save this change.");
      setPending(false);
    }
  }

  return (
    <Modal titleId={titleId} onClose={close} placement="sheet" pending={pending}>
      <h2 id={titleId} className="text-lg font-semibold">{deleting ? "Delete " + copy.item + "?" : item ? "Edit " + copy.item : copy.action}</h2>
      <form onSubmit={submit} className="mt-3 space-y-3 text-sm">
        {deleting ? <p>{plan === "subscriptions" ? "Future expenses will stop. Already recorded payments stay in your activity." : "Remove " + (item && itemName(item)) + " from your plans?"}</p> : (
          <>
            {plan === "budgets" ? <label className="block font-medium">Category
              <select name="category" defaultValue={defaultCategory} required className={field}>
                <option value="" disabled>Choose a category</option>
                {defaultCategory && !categories.has(defaultCategory) && <option value={defaultCategory}>{defaultCategory}</option>}
                {[...categories].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label> : <label className="block font-medium">Name
              <input name="name" defaultValue={item ? itemName(item) : ""} maxLength={120} required className={field} placeholder={plan === "goals" ? "e.g. Weekend trip" : "e.g. Spotify"} />
            </label>}
            <label className="block font-medium">{amountLabel}
              <input name="amount" value={amountText} onChange={(event) => setAmountText(event.target.value)} inputMode="decimal" required className={field} placeholder="0.00" />
            </label>
            {plan === "goals" && <label className="block font-medium">Saved so far (€)
              <input name="saved" defaultValue={item && "saved_minor" in item ? (item.saved_minor / 100).toFixed(2) : ""} inputMode="decimal" className={field} placeholder="0.00" />
            </label>}
            {plan === "subscriptions" && <>
              <div className="grid grid-cols-2 gap-2">
                <label className="min-w-0 font-medium">{cadence === "yearly_split" ? "First monthly entry" : "First payment"}
                  <input type="date" value={firstDate} onChange={(event) => setFirstDate(event.target.value)} required min="1900-01-01" max="9999-01-01" className={field} />
                </label>
                <label className="min-w-0 font-medium">Repeat
                  <select name="cadence" value={yearly ? "yearly" : cadence} onChange={(event) => setCadence(event.target.value as Cadence)} className={field}>
                    <option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                  </select>
                </label>
              </div>
              {yearly && <label className="block font-medium">How to record it
                <select value={cadence} onChange={(event) => setCadence(event.target.value as Cadence)} className={field}>
                  <option value="yearly">Full amount once a year</option>
                  <option value="yearly_split">Split across 12 months</option>
                </select>
              </label>}
              {cadence === "yearly_split" && <p className="text-xs text-[#59685e]">
                {amount !== null && amount >= 12
                  ? (amount % 12 ? formatMinor(Math.floor(amount / 12)) + "–" + formatMinor(Math.ceil(amount / 12)) : formatMinor(amount / 12)) + " per month. The 12 entries add up to " + formatMinor(amount) + "."
                  : "The yearly amount is spread over 12 monthly ledger entries."}
              </p>}
              <label className="flex min-h-10 items-center gap-2"><input type="checkbox" name="active" defaultChecked={!item || ("active" in item && item.active)} className="size-4 accent-[#183c31]" />Automatically record payments</label>
              {firstDate < localToday() && <p className="text-xs text-[#59685e]">Earlier payments can be entered manually. This schedule starts with its next due date.</p>}
            </>}
          </>
        )}
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {item && !deleting && <button type="button" onClick={remove} disabled={pending} className="mr-auto min-h-11 text-sm font-semibold text-red-800">Delete</button>}
          <button type="button" onClick={dismissModal} disabled={pending} className={secondary}>Cancel</button>
          <button disabled={pending} className={deleting ? primary.replace("bg-[#183c31]", "bg-red-800") : primary}>{pending ? "Working…" : deleting ? "Delete" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
