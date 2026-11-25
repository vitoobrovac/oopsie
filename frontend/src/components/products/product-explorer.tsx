
"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/layout/icon";
import { formatMinor, formatQuantity, formatReceiptDate, monthLabel } from "@/lib/finance-format";
import { productEmoji } from "@/lib/product-icons";
import { periodStart } from "@/lib/ledger";
import { groupProducts, searchText, type ReceiptLine } from "@/lib/receipts";
import { useLedger } from "@/lib/use-ledger";
import { useReceipts } from "@/lib/use-receipts";

type Group = ReturnType<typeof groupProducts>[number];
type Purchases = Group["purchases"];
const units: ReceiptLine["unit"][] = ["kg", "L", "unit"];
const sum = (purchases: Purchases) => purchases.reduce((total, { item }) => total + item.amount_minor, 0);
const unitLabel = (unit: ReceiptLine["unit"]) => unit === "unit" ? "item" : unit;

function measure(purchases: Purchases, unit: ReceiptLine["unit"]) {
  const rows = purchases.filter(({ item }) => item.unit === unit && Number(item.quantity) > 0);
  const quantity = rows.reduce((total, { item }) => total + Number(item.quantity), 0);
  return { quantity, price: quantity ? sum(rows) / quantity : null };
}

function near(word: string, term: string) {
  return term.length >= 4 && word.length === term.length && [...term].filter((char, index) => char !== word[index]).length === 1;
}

export function ProductExplorer() {
  const { records, error, retry } = useReceipts();
  const [query, setQuery] = useState("");
  const [visibleProducts, setVisibleProducts] = useState(8);
  const [selectedKey, setSelectedKey] = useState("");
  const terms = searchText(query).split(" ").filter(Boolean);
  const products = groupProducts(records ?? []);
  const direct = products.filter(({ terms: haystack }) => terms.every((term) => haystack.includes(term)));
  const suggestions = !direct.length && terms.length ? products.filter((group) => {
    const words = group.terms.split(" ");
    return terms.every((term) => words.some((word) => word.includes(term) || near(word, term)));
  }) : [];
  const matches = direct.length ? direct : suggestions;
  const selected = matches.find(({ key }) => key === selectedKey) ?? (terms.length ? matches[0] : undefined);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-3xl font-semibold tracking-tight">What did you buy?</h1><p className="mt-2 text-sm text-[#59685e]">Search the products on your receipts and compare prices you paid.</p></div>
        <Link href="/receipts/new" className="inline-flex min-h-11 items-center rounded-xl bg-[#183c31] px-4 text-sm font-semibold text-white">Scan a receipt</Link>
      </header>
      {error ? <p role="alert" className="mt-5 text-sm text-red-800">{error} <button onClick={retry} className="ml-2 underline">Retry</button></p>
        : !records ? <p role="status" className="mt-5 text-sm">Loading products…</p>
        : !products.length ? <p className="mt-5 rounded-2xl border border-[#e4e9e2] bg-white p-5 text-sm">Save a receipt with products to start seeing purchase history.</p>
        : <>
          <label className="mt-5 flex items-center gap-3 rounded-2xl border border-[#dce4d9] bg-white px-4">
            <Icon name="search" className="size-5 shrink-0 text-[#59685e]" />
            <input aria-label="Search products" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedKey(""); setVisibleProducts(8); }} placeholder="Try pears, milk, apple or bread…" className="min-h-12 min-w-0 flex-1 bg-transparent text-base" />
          </label>
          {suggestions.length > 0 && <p className="mt-3 text-sm text-[#59685e]">Showing similar names.</p>}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {matches.slice(0, visibleProducts).map(({ key, name, purchases }) => (
              <button key={key} aria-pressed={selected?.key === key} onClick={() => setSelectedKey(key)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#e4e9e2] bg-white px-2 text-xs sm:text-sm aria-pressed:bg-[#eaf1e7]">
                <span aria-hidden="true">{productEmoji(name, purchases[0].item.category)}</span>{name}
              </button>
            ))}
          </div>
          {matches.length > visibleProducts && <button onClick={() => setVisibleProducts(visibleProducts + 8)} className="mt-1 min-h-11 px-2 text-sm font-semibold text-[#31533c]">See more products ({matches.length - visibleProducts})</button>}
          {selected && <ProductStats key={selected.key} group={selected} />}
          {!matches.length && <p className="mt-5 text-sm text-[#59685e]">No products match “{query}”.</p>}
        </>}
      <Link href="/receipts" className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-[#31533c]">Browse all receipts →</Link>
    </div>
  );
}

function ProductStats({ group }: { group: Group }) {
  const { report, monthStartDay } = useLedger();
  const [visiblePurchases, setVisiblePurchases] = useState(6);
  const purchases = group.purchases;
  const stores = [...new Set(purchases.map(({ receipt }) => receipt.store))];
  const totals = units.map((unit) => ({ unit, ...measure(purchases, unit) })).filter(({ quantity }) => quantity > 0);
  const periods = report.chart.map(({ start, month }) => ({
    month,
    amount: sum(purchases.filter(({ receipt }) => periodStart(receipt.purchased_on, monthStartDay) === start)),
  }));
  const maximum = Math.max(1, ...periods.map(({ amount }) => amount));
  const stats = [
    ["Overall spent", formatMinor(sum(purchases))],
    ["This period", formatMinor(periods[2].amount)],
    ["Last period", formatMinor(periods[1].amount)],
    ["Recorded quantity", totals.map(({ unit, quantity }) => formatQuantity(quantity) + " " + (unit === "unit" ? "count" : unit)).join(" + ") || "—"],
  ];
  return (
    <div className="mt-4 space-y-4">
      <section className="rounded-2xl bg-[#183c31] p-3 text-white sm:p-5">
        <h2 className="flex items-center gap-2 text-xl sm:text-2xl font-semibold"><span aria-hidden="true">{productEmoji(group.name, purchases[0].item.category)}</span>{group.name}</h2>
        <p className="mt-1 text-sm text-[#c5d2cc]">{new Set(purchases.map(({ receipt }) => receipt.id)).size} receipts · {stores.length} stores · Line prices before discounts</p>
        <dl className="mt-2 grid grid-cols-2 gap-2 border-t border-white/20 pt-2 sm:grid-cols-4">
          {stats.map(([label, value]) => <div key={label}><dt className="text-xs text-[#c5d2cc]">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value}</dd></div>)}
        </dl>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <figure className="rounded-2xl border border-[#e4e9e2] bg-white p-4">
          <figcaption className="font-semibold">Spending by period</figcaption>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {periods.map(({ month, amount }) => (
              <div key={month}>
                <div aria-hidden="true" className="flex h-24 items-end justify-center border-b border-[#e4e9e2]"><div className="w-1/2 rounded-t-lg bg-[#86aa62]" style={{ height: 100 * amount / maximum + "%" }} /></div>
                <p className="mt-2 text-xs">{monthLabel(month, "short")}</p><p className="text-sm font-semibold">{formatMinor(amount)}</p>
              </div>
            ))}
          </div>
        </figure>
        {totals.length > 0 && (
          <section className="rounded-2xl border border-[#e4e9e2] bg-white p-4">
            <h3 className="font-semibold">Average paid</h3>
            <p className="mt-1 text-xs text-[#59685e]">Only purchases with a recorded quantity.</p>
            {totals.map(({ unit, price }) => <p className="mt-2 text-sm" key={unit}>{formatMinor(price!)} per {unitLabel(unit)}</p>)}
          </section>
        )}
      </div>
      {units.map((unit) => {
        const prices = stores.map((store) => ({ store, price: measure(purchases.filter(({ receipt }) => receipt.store === store), unit).price }))
          .filter((row): row is { store: string; price: number } => row.price !== null).sort((a, b) => a.price - b.price);
        return prices.length < 2 ? null : (
          <section key={unit} className="rounded-2xl border border-[#e4e9e2] bg-white p-4">
            <h3 className="font-semibold">Store price comparison · per {unitLabel(unit)}</h3>
            <ul className="mt-2 divide-y divide-[#e4e9e2]">
              {prices.map(({ store, price }) => <li key={store} className="flex justify-between gap-2 py-2 text-sm"><span>{store}</span><span>{formatMinor(price)}</span></li>)}
            </ul>
          </section>
        );
      })}
      <section className="rounded-2xl border border-[#e4e9e2] bg-white p-4">
        <h3 className="font-semibold">Purchase history</h3>
        <ul className="mt-2 divide-y divide-[#e4e9e2]">
          {purchases.slice(0, visiblePurchases).map(({ receipt, item }) => (
            <li key={receipt.id + ":" + item.position}>
              <Link href={"/receipts?receipt=" + receipt.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                <span className="min-w-0 break-words"><span className="font-semibold">{item.display_name}</span><span className="block text-xs text-[#59685e]">{item.receipt_name}</span><span className="block text-xs text-[#59685e]">{receipt.store} · {formatReceiptDate(receipt.purchased_on)}{item.quantity === null ? "" : " · " + formatQuantity(Number(item.quantity)) + " " + unitLabel(item.unit)}</span></span>
                <span className="shrink-0 font-semibold">{formatMinor(item.amount_minor)}</span>
              </Link>
            </li>
          ))}
        </ul>
        {purchases.length > visiblePurchases && <button onClick={() => setVisiblePurchases(visiblePurchases + 6)} className="min-h-11 text-sm font-semibold text-[#31533c]">See more purchases ({purchases.length - visiblePurchases})</button>}
      </section>
    </div>
  );
}
