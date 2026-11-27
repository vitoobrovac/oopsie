"use client";

import { useEffect, useId, useState } from "react";
import { accountRequest, useAccount } from "@/components/account/account-provider";
import { Modal } from "@/components/layout/modal";
import { formatMinor, formatReceiptDate } from "@/lib/finance-format";

type Schedule = { id: string; name: string; amount_minor: number; cadence: "weekly" | "monthly" | "yearly"; next_due: string };

export function RecurringIncome() {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return <section className="rounded-2xl border border-[#e4e9e2] bg-white p-4 sm:p-6">
    <button type="button" aria-expanded={open} aria-controls={panel} className="flex min-h-10 w-full items-center justify-between gap-2 text-left font-semibold"
      onClick={() => setOpen(!open)}>Recurring income <span className="text-sm text-[#31533c]">{open ? "Hide" : "Manage"}</span></button>
    <div id={panel}>{open && <Schedules />}</div>
  </section>;
}

function Schedules() {
  const { session, ledgerRevision, refreshLedger } = useAccount();
  const [rows, setRows] = useState<Schedule[]>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [target, setTarget] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const title = useId();
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    void accountRequest<Schedule[]>(session, "recurring-income", { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) { setRows(data); setError(""); } },
      (reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load schedules."); },
    );
    return () => controller.abort();
  }, [session, ledgerRevision, attempt]);

  async function stop() {
    if (!session || !target || busy) return;
    setError("");
    setBusy(true);
    try {
      await accountRequest(session, "recurring-income/" + target.id, { method: "DELETE" });
      setRows((current) => current?.filter((row) => row.id !== target.id));
      setTarget(null);
      refreshLedger();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not stop this schedule.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    {error && !target ? <p role="alert" className="mt-2 text-sm text-red-800">{error}
      <button type="button" className="ml-2 min-h-10 underline" onClick={() => { setError(""); setAttempt((count) => count + 1); }}>Retry</button>
    </p> : !rows ? <p role="status" className="mt-2 text-sm text-[#59685e]">Loading schedules…</p> :
      rows.length === 0 ? <p className="mt-2 text-sm text-[#59685e]">Choose a repeat option when you add income to create a schedule.</p> :
        <ul className="mt-2 divide-y divide-[#edf0ec]">{rows.map((row) => <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <div className="min-w-0"><p className="wrap-break-word font-medium">{row.name}</p>
            <p className="text-xs text-[#59685e]">{formatMinor(row.amount_minor)} · {row.cadence} · Next {formatReceiptDate(row.next_due)}</p></div>
          <button type="button" className="min-h-11 px-2 text-xs font-semibold text-[#922d2c]" onClick={() => setTarget(row)}>Stop</button>
        </li>)}</ul>}
    {target && <Modal titleId={title} pending={busy} onClose={() => { setTarget(null); setError(""); }}>
      <h2 id={title} className="font-semibold">Stop recurring income?</h2>
      <p className="mt-2 text-sm text-[#59685e]">Future payments for {target.name} will stop. Payments already recorded will stay in Activity.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" autoFocus disabled={busy} onClick={() => { setTarget(null); setError(""); }} className="min-h-11 px-3 text-sm">Cancel</button>
        <button type="button" disabled={busy} className="min-h-11 rounded-xl bg-[#922d2c] px-3 text-sm font-semibold text-white disabled:opacity-50"
          onClick={() => void stop()}>{busy ? "Stopping…" : "Stop future payments"}</button>
      </div>
    </Modal>}
  </>;
}
