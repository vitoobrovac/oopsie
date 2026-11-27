"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { Modal } from "@/components/layout/modal";
import { accountRequest, supabase, useAccount } from "@/components/account/account-provider";
import { localPlanningKey } from "@/lib/local-planning";
import { saveMotionPreference } from "@/lib/motion-preference";

type Confirmation = { request_id: string; email: string };
const destructive = "min-h-11 rounded-xl bg-[#922d2c] px-4 text-sm font-semibold text-white disabled:opacity-50";

export function AccountReset() {
  const { session, refreshLedger, retryReceipts } = useAccount();
  const title = useId();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  function close() {
    setOpen(false);
    setError("");
    setConfirmation(null);
  }

  async function sendCode() {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      setConfirmation(await accountRequest<Confirmation>(session, "account/reset/request", { method: "POST" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send the email. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || busy || !confirmation) return;
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    setBusy(true);
    setError("");
    try {
      await accountRequest(session, "account/reset/confirm", { method: "POST", body: JSON.stringify({
        request_id: confirmation.request_id, code,
      }) });
      setDone(true);
      try {
        window.localStorage.removeItem(localPlanningKey(session.user.id));
        saveMotionPreference(false);
      } catch {
        // Browser preferences are optional.
      }
      refreshLedger();
      retryReceipts();
      await supabase?.auth.refreshSession();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reset your data. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-red-200 bg-white p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-[#7d2c2a]">Reset account data</h2>
      <p className="mt-1 text-sm text-[#59685e]">Start over with an empty Oopsie account and keep your current sign-in.</p>
      {done ? <p role="status" className="mt-3 text-sm font-medium text-[#31533c]">Your Oopsie data has been reset.</p> :
        <button type="button" disabled={!session?.user.email} onClick={() => setOpen(true)}
          className="mt-3 min-h-11 rounded-xl border border-red-200 px-3 text-sm font-semibold text-[#922d2c] disabled:opacity-50">
          Reset my data
        </button>}
      {open && <Modal titleId={title} pending={busy} onClose={close} placement="sheet">
        <h2 id={title} className="text-lg font-semibold">{done ? "You’re ready to start over" : "Permanently reset your data?"}</h2>
        {done ? <>
          <p role="status" className="mt-2 text-sm text-[#59685e]">Your Oopsie account is empty and your sign-in still works.</p>
          {!busy && <Link href="/" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#183c31] px-4 text-sm font-semibold text-white">Go to Overview</Link>}
        </> : <>
          <p className="mt-2 text-sm text-[#59685e]">This erases transactions, receipts, saved product names, budgets, goals, subscriptions, income schedules, preferences, and Hunt progress. This is permanent.</p>
          {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
          {confirmation ? <form className="mt-4 space-y-3" onSubmit={confirm}>
            <p className="wrap-break-word text-sm text-[#59685e]">Enter the code sent to <strong>{confirmation.email}</strong>. The reset request expires after 15 minutes.</p>
            <label className="block text-sm font-medium">Email confirmation code
              <input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}"
                maxLength={10} className="mt-1 min-h-11 w-full rounded-xl border border-[#dfe5dc] px-3 text-base" />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" disabled={busy} onClick={close} className="min-h-11 px-3 text-sm">Cancel</button>
              <button type="submit" disabled={busy} className={destructive}>{busy ? "Resetting…" : "Confirm and reset"}</button>
            </div>
            <button type="button" disabled={busy} onClick={() => void sendCode()} className="min-h-11 text-sm font-medium underline">Send a new code</button>
          </form> : <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" autoFocus disabled={busy} onClick={close} className="min-h-11 px-3 text-sm">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void sendCode()} className={destructive}>{busy ? "Sending…" : "Send confirmation email"}</button>
          </div>}
        </>}
      </Modal>}
    </section>
  );
}
