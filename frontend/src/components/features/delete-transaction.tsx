"use client";

import { dismissModal, Modal } from "@/components/layout/modal";
import { useId, useState } from "react";

export function DeleteTransaction({ name, remove }: { name: string; remove: () => void | Promise<void> }) {
  const title = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await remove();
      setOpen(false);
    } catch {
      setError("Could not delete the transaction. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button aria-label={"Delete " + name} className="min-h-11 px-2 text-xs font-medium text-[#9b302c]"
        onClick={() => { setError(""); setOpen(true); }}>Delete</button>
      {open && (
        <Modal titleId={title} onClose={() => setOpen(false)} pending={busy}>
          <h2 id={title} className="font-semibold">Delete transaction?</h2>
          <p className="mt-2 break-words text-sm text-[#59685e]">“{name}” will be removed from Activity and your totals. Any linked receipt and purchase history will also be removed.</p>
          {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
          <div className="mt-4 flex justify-end gap-3">
            <button autoFocus disabled={busy} className="min-h-11 rounded-xl border border-[#dce4d9] px-3"
              onClick={dismissModal}>Cancel</button>
            <button disabled={busy} className="min-h-11 rounded-xl bg-[#9b302c] px-3 font-medium text-white"
              onClick={() => void confirm()}>{busy ? "Deleting…" : "Delete transaction"}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
