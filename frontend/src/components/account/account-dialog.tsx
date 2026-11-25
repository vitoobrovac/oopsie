
"use client";

import { useId, useState, type ReactNode } from "react";
import { dismissModal, Modal } from "@/components/layout/modal";
import { supabase, useAccount } from "./account-provider";

export function AccountButton() {
  const { session } = useAccount();
  const [open, setOpen] = useState(false);
  if (!session) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-[#31533c] hover:bg-[#edf1eb]">
        Account
      </button>
      {open && <AccountDialog email={session.user.email} onClose={() => setOpen(false)} />}
    </>
  );
}

function AccountDialog({ email, onClose }: { email?: string; onClose: () => void }) {
  const title = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    if (!supabase || busy) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      onClose();
    } catch {
      setError("Could not sign out. Try again.");
      setBusy(false);
    }
  }

  return (
    <Modal titleId={title} onClose={onClose} pending={busy} placement="sheet">
      <header className="flex items-center justify-between gap-2">
        <h2 id={title} className="text-lg font-semibold">Your account</h2>
        <button className="min-h-11 px-2 text-sm" disabled={busy} onClick={dismissModal}>Close</button>
      </header>
      {email && <p className="mb-3 break-all text-sm">{email}</p>}
      <button disabled={busy} className="min-h-11 rounded-xl border border-[#dce4d9] px-3" onClick={() => void signOut()}>
        {busy ? "Signing out…" : "Sign out on this device"}
      </button>
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    </Modal>
  );
}

export function LedgerContent({ children }: { children: ReactNode }) {
  const { remote, retry } = useAccount();
  if (remote?.data) return children;
  return (
    <div role="status" className="mx-auto mb-4 max-w-7xl rounded-xl border border-[#dce4d9] bg-white px-4 py-2 text-sm">
      {remote?.error ?? "Loading your private ledger…"}
      {remote?.error && <button className="ml-3 min-h-10 font-semibold text-[#31533c]" onClick={retry}>Retry</button>}
    </div>
  );
}
