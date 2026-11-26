
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { formatMinor, formatQuantity, formatReceiptDate } from "@/lib/finance-format";
import { searchText, type Receipt } from "@/lib/receipts";
import { useReceipts } from "@/lib/use-receipts";

export function ReceiptLibrary() {
  const { records, error, retry } = useReceipts();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [day, setDay] = useState("");
  const term = searchText(query);
  const matches = records?.filter((receipt) => searchText(receipt.store).includes(term) && (!day || receipt.purchased_on === day));
  const requested = params.get("receipt");
  const selected = matches?.find(({ id }) => id === requested);
  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-3xl font-semibold tracking-tight">Receipts</h1><p className="mt-2 text-sm text-[#59685e]">Find a receipt by store or date.</p></div>
        <Link href="/receipts/new" className="inline-flex min-h-11 items-center rounded-xl bg-[#183c31] px-4 text-sm font-semibold text-white">Scan a receipt</Link>
      </header>
      {error ? <p role="alert" className="mt-5 text-sm text-red-800">{error} <button onClick={retry} className="ml-2 underline">Retry</button></p>
        : !records ? <p role="status" className="mt-5 text-sm">Loading receipts…</p>
        : !records.length ? <p className="mt-5 rounded-2xl border border-[#e4e9e2] bg-white p-5 text-sm">Scan your first receipt to see it here.</p> : (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Search stores<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. EUROSPAR" className="mt-1 min-h-11 w-full rounded-xl border border-[#dce4d9] bg-white px-3 text-base" /></label>
              <label className="text-sm">Filter by date<input type="date" value={day} onChange={(event) => setDay(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[#dce4d9] bg-white px-3 text-base" /></label>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <ul className="space-y-2">
                {matches?.map((row) => {
                  const isOpen = selected?.id === row.id;
                  return (
                    <li key={row.id}>
                      <Link href={isOpen ? "/receipts" : "/receipts?receipt=" + row.id} replace={isOpen} scroll={false} aria-expanded={isOpen}
                        className={"flex min-h-14 items-center justify-between gap-2 rounded-xl border border-[#e4e9e2] p-3 " + (isOpen ? "bg-[#edf3e8]" : "bg-white")}>
                        <span className="min-w-0 break-words text-sm font-semibold">{row.store}<span className="block text-xs font-normal text-[#59685e]">{formatReceiptDate(row.purchased_on)} · {row.lines.filter(({ kind }) => kind === "product").length} products</span></span>
                        <span className="shrink-0 text-sm font-medium tabular-nums">{formatMinor(row.total_minor)}</span>
                      </Link>
                      {isOpen && <div className="mt-2 lg:hidden"><ReceiptDetails receipt={row} /></div>}
                    </li>
                  );
                })}
                {!matches?.length && <li className="text-sm text-[#59685e]">No receipts match these filters.</li>}
              </ul>
              {selected && <div className="hidden lg:block"><ReceiptDetails receipt={selected} /></div>}
            </div>
          </>
        )}
    </div>
  );
}

function ReceiptDetails({ receipt }: { receipt: Receipt }) {
  return (
    <section className="rounded-2xl border border-[#e4e9e2] bg-white p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-xl font-semibold tracking-tight">{receipt.store}</h2>
          <p className="text-sm text-[#59685e]">{formatReceiptDate(receipt.purchased_on)}</p>
        </div>
        <Link href="/receipts" replace scroll={false} className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-[#dce4d9] px-3 text-sm font-semibold text-[#31533c]">Close receipt</Link>
      </div>
      <ul className="mt-4 divide-y divide-[#e4e9e2]">
        {receipt.lines.map((line) => (
          <li key={line.position} className="flex items-start justify-between gap-3 py-3 text-sm">
            <div className="min-w-0 break-words">
              <p className="font-semibold">{line.display_name}</p>
              <p className="text-xs text-[#59685e]">{line.receipt_name}</p>
              <p className="mt-1 text-xs text-[#59685e]">{[
                line.kind === "product" ? line.category : line.kind === "discount" ? "Discount" : "Deposit",
                line.quantity === null ? "" : formatQuantity(Number(line.quantity)) + (line.unit === "unit" ? " ×" : " " + line.unit),
              ].filter(Boolean).join(" · ")}</p>
            </div>
            <span className="shrink-0 font-medium tabular-nums">{formatMinor(line.amount_minor)}</span>
          </li>
        ))}
      </ul>
      <p className="flex justify-between border-t border-[#e4e9e2] pt-3 font-semibold"><span>Total</span><span>{formatMinor(receipt.total_minor)}</span></p>
    </section>
  );
}
