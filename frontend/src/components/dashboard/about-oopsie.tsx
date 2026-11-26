"use client";

import { useId, useState } from "react";
import { BrandLogo } from "@/components/layout/brand-logo";
import { dismissModal, Modal } from "@/components/layout/modal";

const description = "Oopsie is a personal finance app that helps you understand where your money goes. Track income and expenses, scan receipts into searchable purchases, and see spending patterns over time. Set budgets and savings goals, and keep recurring bills and yearly expenses in view.";

export function AboutOopsie() {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-xs font-semibold text-[#31533c]">
        <span aria-hidden="true" className="grid size-4 place-items-center rounded-full border border-current text-[10px]">?</span>
        What is oopsie?
      </button>
      {open && <Modal titleId={titleId} onClose={() => setOpen(false)} placement="sheet">
        <div className="oopsie-reveal">
          <div className="grid place-items-center rounded-2xl bg-linear-to-br from-[#eaf4df] to-[#f9ebc8] p-3"><BrandLogo /></div>
          <h2 id={titleId} className="mt-4 text-xl font-semibold tracking-tight">What is oopsie?</h2>
          <p className="mt-2 text-sm leading-6 text-[#526458]">{description}</p>
          <button type="button" onClick={dismissModal} className="mt-4 min-h-11 w-full rounded-xl bg-[#183c31] px-4 text-sm font-semibold text-white">Got it</button>
        </div>
      </Modal>}
    </>
  );
}
