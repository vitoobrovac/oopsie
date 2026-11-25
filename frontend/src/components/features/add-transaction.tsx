"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { dismissModal, Modal } from "@/components/layout/modal";
import { Toast } from "@/components/layout/toast";
import { Icon } from "@/components/layout/icon";
import { localToday, useLedger } from "@/lib/use-ledger";
import { isDate, parseAmount } from "@/lib/ledger";

const expenseCategories = [
  ["Groceries", "Groceries"], ["Dinner", "Dining out"], ["Fun", "Entertainment"],
  ["Transport", "Transport"], ["Housing", "Housing"], ["Subscriptions", "Subscriptions"],
];
const incomeCategories = [["Salary", "Salary"], ["Freelance", "Freelance"], ["Other income", "Other income"]];
const field = "mt-1 min-h-11 w-full rounded-xl border border-[#dce4d9] bg-white px-3 py-2 text-base";

export function AddTransactionButton() {
  const { canWrite } = useLedger();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <>
      <button disabled={!canWrite} onClick={() => { setSaved(false); setOpen(true); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#183c31] px-3 text-sm font-medium text-white disabled:opacity-50">
        <Icon name="plus" className="size-4" />Add transaction
      </button>
      {open && <TransactionDialog onClose={() => setOpen(false)} onSave={() => { setOpen(false); setSaved(true); }} />}
      {saved && <Toast dismiss={() => setSaved(false)}>Transaction saved to your account.</Toast>}
    </>
  );
}

function TransactionDialog({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const { saveEntry } = useLedger();
  const [pending, setPending] = useState(false);
  const titleId = useId();
  const [manual, setManual] = useState(false);
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const today = localToday();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("description") ?? "").trim();
    const amountMinor = parseAmount(String(data.get("amount") ?? ""));
    const date = String(data.get("date") ?? "");
    if (!name) return setError("Enter a description.");
    if (amountMinor === null) return setError("Enter an amount above zero with up to two decimal places, such as 12,50.");
    if (!isDate(date) || date > today) return setError("Choose a valid date up to today.");
    setPending(true);
    try {
      await saveEntry({
        name, date, category: category || (kind === "income" ? "Income" : "Uncategorized"),
        merchant: String(data.get("merchant") ?? "").trim(),
        amountMinor: kind === "income" ? amountMinor : -amountMinor,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the entry. Try again.");
      setPending(false);
      return;
    }
    onSave();
  }

  return (
    <Modal titleId={titleId} onClose={onClose} pending={pending} placement="sheet">
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="text-lg font-semibold">{manual ? "Add manually" : "Add a transaction"}</h2>
        <button disabled={pending} onClick={dismissModal} className="min-h-11 px-2 text-sm text-[#31533c]">Close</button>
      </div>
      {!manual ? (
        <div className="mt-2 grid gap-2">
          <Link href="/receipts/new" onClick={dismissModal} className="rounded-xl border border-[#dce4d9] p-4 text-left">
            <span className="block font-semibold">Scan a receipt</span>
            <span className="text-xs text-[#59685e]">Take a photo or upload one</span>
          </Link>
          <button onClick={() => { setError(""); setManual(true); }} className="rounded-xl border border-[#dce4d9] p-4 text-left">
            <span className="block font-semibold">Add manually</span>
            <span className="text-xs text-[#59685e]">Record an expense or income</span>
          </button>
          {error && <p role="status" className="text-sm text-[#59685e]">{error}</p>}
        </div>
      ) : (
        <form className="mt-2 grid gap-3" onSubmit={handleSubmit}>
          <fieldset>
            <legend className="text-sm font-medium">Transaction type</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(["expense", "income"] as const).map((option) => (
                <label key={option} className="flex min-h-11 items-center gap-2 rounded-xl border border-[#dce4d9] px-3 capitalize has-checked:bg-[#eaf1e7]">
                  <input type="radio" name="type" value={option} checked={kind === option}
                    onChange={() => { setKind(option); setCategory(""); }} />{option}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-sm font-medium">Description (required)
            <input name="description" required maxLength={120} placeholder={kind === "expense" ? "e.g. Dinner with friends" : "e.g. November salary"} className={field} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0 text-sm font-medium">Amount in EUR (required)
              <input name="amount" required inputMode="decimal" maxLength={13} placeholder="12,50" className={field} />
            </label>
            <label className="min-w-0 text-sm font-medium">Date
              <input name="date" type="date" required defaultValue={today} min="1900-01-01" max={today} className={field} />
            </label>
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Category (optional)</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {(kind === "expense" ? expenseCategories : incomeCategories).map(([label, value]) => (
                <button type="button" key={value} aria-pressed={category === value}
                  onClick={() => setCategory(category === value ? "" : value)}
                  className="min-h-10 rounded-full border border-[#dce4d9] px-3 text-sm aria-pressed:bg-[#eaf1e7] aria-pressed:font-semibold">
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="text-sm font-medium">{kind === "expense" ? "Merchant or market" : "Payer"} (optional)
            <input name="merchant" maxLength={120} className={field} />
          </label>
          {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
          <button type="submit" disabled={pending} className="min-h-11 rounded-xl bg-[#183c31] px-4 text-sm font-semibold text-white">
            {pending ? "Saving…" : "Save " + kind}
          </button>
        </form>
      )}
    </Modal>
  );
}
