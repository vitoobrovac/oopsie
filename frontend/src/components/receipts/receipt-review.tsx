"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Icon } from "@/components/layout/icon";
import { dismissModal, Modal } from "@/components/layout/modal";
import { ScanProgress } from "./scan-progress";
import { needsScanFeedback, ReceiptRecognitionError, scanReceipt, scanStages, type ScanStage } from "@/lib/receipt-scan";
import { accountRequest, supabase, useAccount } from "@/components/account/account-provider";
import { formatMinor } from "@/lib/finance-format";
import { expenseCategories, isDate, parseAmount } from "@/lib/ledger";
import { localToday } from "@/lib/use-ledger";
import { productEmoji } from "@/lib/product-icons";
import { newReceiptId, type ReceiptDraft, type ReceiptLine } from "@/lib/receipts";

type LineEdit = {
  key: string;
  kind: ReceiptLine["kind"];
  original: string;
  name: string;
  category: string;
  amount: string;
  quantity: string;
  unit: ReceiptLine["unit"];
  aliases: string[];
  review: boolean;
  checkPrice: boolean;
  remember: boolean;
};

const input = "mt-1 min-h-11 w-full min-w-0 rounded-xl border border-[#dce4d9] bg-white px-3 text-base";
const button = "inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold";
const primary = button + " bg-[#183c31] text-white disabled:opacity-55";
const secondary = button + " border border-[#dce4d9] bg-white text-[#183c31]";
const currencies = {
  EUR: "Euro", USD: "US dollar", GBP: "British pound", AUD: "Australian dollar",
  CAD: "Canadian dollar", NZD: "New Zealand dollar", CHF: "Swiss franc",
};

type Quote = { rate_date: string; units_per_eur: string };
type QuoteState = { currency: string; quote?: Quote; error?: string };

function isSupportedCurrency(code: string) {
  return Object.hasOwn(currencies, code);
}

function euroTotal(cents: number, unitsPerEuro: string) {
  const [whole, fraction = ""] = unitsPerEuro.split(".");
  const denominator = BigInt(whole + fraction);
  const numerator = BigInt(cents) * BigInt("1" + "0".repeat(fraction.length));
  return Number((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)));
}

const photoTypes = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
const feedbackFormats = [
  { type: "image/jpeg", extension: "jpg", suffix: /\.jpe?g$/i },
  { type: "image/png", extension: "png", suffix: /\.png$/i },
  { type: "image/webp", extension: "webp", suffix: /\.webp$/i },
];
type FeedbackPhoto = { id: string; file: File };

function moneyInput(cents: number | null) {
  return cents === null ? "" : (Math.abs(cents) / 100).toFixed(2);
}

function formatDraftAmount(cents: number, currency: string) {
  if (currency === "EUR") return formatMinor(cents);
  if (currency === "$") return (cents < 0 ? "−" : "") + "$" + (Math.abs(cents) / 100).toFixed(2);
  return (cents / 100).toFixed(2) + (currency ? " " + currency : "");
}

function readAmount(value: string) {
  if (/^0+(?:[.,]0{1,2})?$/.test(value.trim())) return 0;
  return parseAmount(value);
}

function blankLine(): LineEdit {
  return { key: newReceiptId(), kind: "product", original: "", name: "", category: "",
    amount: "", quantity: "", unit: "unit", aliases: [], review: true, checkPrice: true, remember: false };
}

export function ReceiptReview() {
  const { session, receiptSaved } = useAccount();
  const router = useRouter();
  const discardTitle = useId();
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [editing, setEditing] = useState(false);
  const [editHeader, setEditHeader] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [store, setStore] = useState("");
  const [day, setDay] = useState("");
  const [currency, setCurrency] = useState("");
  const [categoryOverride, setCategoryOverride] = useState("");
  const [suggestedCategory, setSuggestedCategory] = useState("");
  const [quoteState, setQuoteState] = useState<QuoteState | null>(null);
  const [rateRefresh, setRateRefresh] = useState(0);
  const [total, setTotal] = useState("");
  const [lines, setLines] = useState<LineEdit[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [batch, setBatch] = useState<{ number: number; count: number; remaining: ReceiptDraft[] } | null>(null);
  const [scanStage, setScanStage] = useState<ScanStage>("upload");
  const [busy, setBusy] = useState<"scan" | "save" | "feedback" | null>(null);
  const [feedbackPhoto, setFeedbackPhoto] = useState<FeedbackPhoto | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState<"sent" | "error" | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const supported = isSupportedCurrency(currency);
  const needsRate = supported && currency !== "EUR";
  const rateState = quoteState?.currency === currency ? quoteState : null;
  const quote = rateState?.quote;

  useEffect(() => {
    if (!session || !editing || !needsRate) return;
    const controller = new AbortController();
    void accountRequest<Quote>(session, "receipts/exchange-rate?currency=" + encodeURIComponent(currency), {
      signal: controller.signal,
    }).then(
      (result) => { if (!controller.signal.aborted) setQuoteState({ currency, quote: result }); },
      (reason) => {
        if (!controller.signal.aborted) setQuoteState({ currency, error: reason instanceof Error ? reason.message : "Could not load the exchange rate." });
      },
    );
    return () => controller.abort();
  }, [session, editing, currency, needsRate, rateRefresh]);

  function refreshRate() {
    setError("");
    setQuoteState(null);
    setRateRefresh((attempt) => attempt + 1);
  }

  function populate(draft: ReceiptDraft) {
    setReceiptId(newReceiptId());
    setStore(draft.store ?? "");
    setDay(draft.date ?? "");
    setCurrency(draft.currency ?? "");
    setCategoryOverride("");
    setSuggestedCategory(draft.spending_category ?? "");
    setQuoteState(null);
    setTotal(moneyInput(draft.total_minor));
    setWarnings(draft.warnings);
    setEditHeader(!draft.store || !draft.date || draft.currency !== "EUR" || draft.total_minor === null);
    setLines(draft.lines.length ? draft.lines.map((item) => ({
      key: newReceiptId(), kind: item.kind, original: item.receipt_name, name: item.review && item.kind === "product" ? "" : item.display_name,
      category: item.category, amount: moneyInput(item.amount_minor), quantity: String(item.quantity ?? ""),
      unit: item.unit, aliases: item.aliases, review: item.review, checkPrice: item.amount_minor === null,
      remember: item.review && item.kind === "product",
    })) : [blankLine()]);
    setEditing(true);
  }

  async function scan(file?: File) {
    if (!file || !session || busy) return;
    setError("");
    setFeedbackPhoto(null);
    setFeedbackStatus(null);
    if (file.size > 10 * 1024 * 1024) return setError("Choose a photo under 10 MB.");
    const feedback = { id: newReceiptId(), file };
    setPreview(URL.createObjectURL(file));
    setScanStage("upload");
    setBusy("scan");
    try {
      const draft = await scanReceipt(session, file, (stage) => {
        setScanStage((current) => scanStages[stage].percent > scanStages[current].percent ? stage : current);
      });
      setScanStage("ready");
      const remaining = draft.additional_receipts ?? [];
      setBatch(remaining.length ? { number: 1, count: remaining.length + 1, remaining } : null);
      if (needsScanFeedback(draft)) setFeedbackPhoto(feedback);
      populate(draft);
    } catch (reason) {
      if (reason instanceof ReceiptRecognitionError) setFeedbackPhoto(feedback);
      setError(reason instanceof Error ? reason.message : "Could not scan the photo.");
    } finally {
      setBusy(null);
    }
  }

  async function sendFeedback() {
    if (!supabase || !session || !feedbackPhoto || busy) return;
    const { id, file } = feedbackPhoto;
    const format = feedbackFormats.find(({ type, suffix }) => file.type === type || (!file.type && suffix.test(file.name)));
    setBusy("feedback");
    setFeedbackStatus(null);
    try {
      if (!format) throw new Error("Unsupported photo format");
      const path = session.user.id + "/" + id + "." + format.extension;
      const { error } = await supabase.storage.from("receipt-scan-feedback")
        .upload(path, file.slice(0, file.size, format.type), { upsert: false, cacheControl: "0" });
      const alreadySent = error && "code" in error && (error.code === "ResourceAlreadyExists" || error.code === "KeyAlreadyExists");
      if (error && !alreadySent) throw error;
      setFeedbackStatus("sent");
      setFeedbackPhoto(null);
    } catch {
      setFeedbackStatus("error");
    } finally {
      setBusy(null);
    }
  }

  function reviewNextReceipt() {
    const next = batch?.remaining[0];
    if (!batch || !next) return false;
    setError("");
    setBatch({ ...batch, number: batch.number + 1, remaining: batch.remaining.slice(1) });
    populate(next);
    return true;
  }

  function resetDraft() {
    setEditing(false);
    setReceiptId(null);
    setPreview("");
    setEditHeader(false);
    setStore("");
    setDay("");
    setCurrency("");
    setCategoryOverride("");
    setSuggestedCategory("");
    setQuoteState(null);
    setTotal("");
    setLines([]);
    setWarnings([]);
    setError("");
    setBatch(null);
    setScanStage("upload");
    setFeedbackPhoto(null);
    setFeedbackStatus(null);
  }

  function updateLine(key: string, patch: Partial<LineEdit>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  const knownAmounts = lines.map((line) => readAmount(line.amount));
  const calculated = knownAmounts.every((value) => value !== null)
    ? lines.reduce((sum, line, index) => sum + (line.kind === "discount" ? -1 : 1) * (knownAmounts[index] ?? 0), 0)
    : null;
  const printedTotal = readAmount(total);
  const convertedTotal = quote && printedTotal ? euroTotal(printedTotal, quote.units_per_eur) : null;
  const needsProductLabel = (line: LineEdit) => line.kind === "product" && line.review;
  const needsAttention = (line: LineEdit) => needsProductLabel(line) || line.checkPrice;
  const unanswered = lines.filter(needsAttention).length;
  const reviewOrder = lines.map((line, index) => ({ line, index }))
    .sort((a, b) => Number(needsAttention(b.line)) - Number(needsAttention(a.line)));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !receiptId || busy) return;
    setError("");
    if (!store.trim() || !isDate(day) || day > localToday()) return setError("Enter the store and a valid purchase date.");
    if (!supported) return setError("Select the currency printed on this receipt.");
    if (needsRate && !quote) return setError("Load the exchange rate before saving.");
    if (!printedTotal || calculated !== printedTotal || !lines.some((line) => line.kind === "product")) {
      return setError("Enter the printed total and check that all lines, including discounts and deposits, add up to it.");
    }
    const cleanLines = [];
    for (const [index, line] of lines.entries()) {
      if (!line.name.trim()) return setError("Enter a name for each unrecognized item.");
      if (line.kind === "product" && line.review && !line.category.trim()) return setError("Add a category for each unrecognized item.");
      const quantity = line.kind === "discount" ? "" : line.quantity.trim().replace(",", ".");
      if (quantity && (!/^\d+(?:\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0 || Number(quantity) > 1000000)) {
        return setError("Quantities must be positive, with up to three decimal places.");
      }
      const amount = knownAmounts[index]!;
      if (line.kind === "discount" && amount === 0) return setError("A discount must be larger than zero.");
      cleanLines.push({
        kind: line.kind, receipt_name: line.original.trim() || line.name.trim(), display_name: line.name.trim(),
        category: line.category.trim(), amount_minor: line.kind === "discount" ? -amount : amount,
        quantity: quantity || null, unit: line.unit, aliases: line.aliases,
        remember: line.kind === "product" && line.remember,
      });
    }
    setBusy("save");
    try {
      const saved = await accountRequest<{ id: string }>(session, "receipts", {
        method: "POST", body: JSON.stringify({ id: receiptId, store: store.trim(), date: day, currency, rate_date: quote?.rate_date,
          total_minor: printedTotal, spending_category: categoryOverride || undefined, lines: cleanLines }),
      });
      receiptSaved();
      if (!reviewNextReceipt()) {
        resetDraft();
        router.replace("/transactions?savedReceipt=" + encodeURIComponent(saved.id));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the receipt.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/receipts" className="inline-flex min-h-11 items-center text-sm font-semibold text-[#31533c]">← Receipts</Link>
        {editing && <button type="button" disabled={Boolean(busy)} className="min-h-11 text-sm font-medium text-[#59685e] underline" onClick={() => setDiscardOpen(true)}>Start over</button>}
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">{editing ? "Review your receipt" : "Scan a receipt"}</h1>
      <p className="mt-2 text-sm text-[#59685e]">
        {editing ? "Tell oopsie what any unfamiliar items are, then check the total and save." : "Take a clear photo of the whole receipt, or choose one from your device."}
      </p>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {(feedbackPhoto || feedbackStatus === "sent") && (
        <section aria-label="Receipt scan feedback" className="mt-4 rounded-2xl border border-[#eee1cb] bg-[#fffaf0] p-4">
          {feedbackStatus === "sent" ? (
            <p role="status" className="text-sm font-medium text-[#31533c]">Thanks. Your photo was sent to Oopsie support for manual review.</p>
          ) : <>
            <h2 className="text-sm font-semibold">Oopsie couldn’t read enough of this receipt</h2>
            <p className="mt-1 text-sm text-[#59685e]">Receipt scanning is still improving. You can share the original photo privately with Oopsie support so they can check what went wrong.</p>
            <p className="mt-1 text-xs text-[#59685e]">Support can view everything visible in the photo. You can still enter or correct the receipt yourself.</p>
            <button type="button" className={secondary + " mt-3 disabled:opacity-55"} disabled={Boolean(busy)} onClick={sendFeedback}>
              {busy === "feedback" ? "Sending photo…" : feedbackStatus === "error" ? "Retry sending photo" : "Send photo for review"}
            </button>
            {feedbackStatus === "error" && <p role="alert" className="mt-2 text-xs text-red-800">Couldn’t send the photo. Try again or continue with the receipt.</p>}
          </>}
        </section>
      )}

      {!editing && (
        <section className="mt-5 space-y-3 rounded-2xl border border-[#e4e9e2] bg-white p-5">
          <fieldset disabled={Boolean(busy)} className="grid gap-3 sm:grid-cols-2">
            <label className={primary + " cursor-pointer gap-2 focus-within:ring-2 focus-within:ring-[#537d65]"}>
              <Icon name="camera" className="size-5 shrink-0" />
              Take a photo
              <input type="file" accept="image/*" capture="environment" className="sr-only"
                onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; void scan(file); }} />
            </label>
            <label className={secondary + " cursor-pointer gap-2 focus-within:ring-2 focus-within:ring-[#537d65]"}>
              <Icon name="upload" className="size-5 shrink-0" />
              Upload a photo
              <input type="file" accept={photoTypes} className="sr-only"
                onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; void scan(file); }} />
            </label>
          </fieldset>
          {busy === "scan" && <ScanProgress stage={scanStage} />}
          <button type="button" disabled={Boolean(busy)} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#31533c] underline"
            onClick={() => { setError(""); populate({ store: null, date: localToday(), currency: "EUR", total_minor: null, lines: [], warnings: [] }); }}>
            <Icon name="pencil" className="size-4 shrink-0" />
            Enter receipt manually
          </button>
          <p className="text-xs text-[#59685e]">JPEG, PNG or WebP · Up to 10 MB. The photo is processed for this scan.</p>
        </section>
      )}

      {discardOpen && (
        <Modal titleId={discardTitle} onClose={() => setDiscardOpen(false)}>
              <h2 id={discardTitle} className="font-semibold">Discard this draft?</h2>
              <p className="mt-2 text-sm text-[#59685e]">You’ll lose the changes you made to this receipt.</p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" autoFocus className={secondary} onClick={dismissModal}>Keep editing</button>
                <button type="button" className={primary} onClick={(event) => {
                  resetDraft();
                  dismissModal(event);
                }}>Discard draft</button>
              </div>
        </Modal>
      )}

      {editing && (
        <form onSubmit={save} className="mt-5 space-y-4">
          {preview && scanStage === "ready" && <p role="status" className="text-xs font-semibold text-[#31533c]">100% · Scan complete{batch ? " · Receipt " + batch.number + " of " + batch.count : ""}</p>}
          {preview && (
            <details className="rounded-2xl border border-[#e4e9e2] bg-white p-4">
              <summary className="cursor-pointer text-sm font-semibold">View original photo</summary>
              <Image src={preview} alt="Receipt photo you selected" width={480} height={640} unoptimized className="mx-auto mt-3 h-auto max-h-[65vh] w-auto max-w-full object-contain" />
            </details>
          )}
          {warnings.length > 0 && (
            <details className="rounded-2xl border border-[#eee1cb] bg-[#fffaf0] px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold">Scan notes · {warnings.length}</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{warnings.map((note, index) => <li key={index}>{note}</li>)}</ul>
            </details>
          )}
          <fieldset disabled={Boolean(busy)} className="space-y-4">
            <section className="rounded-2xl border border-[#e4e9e2] bg-white p-3 sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0"><p className="break-words text-sm font-semibold">{store || "Store needed"}</p><p className="text-xs text-[#59685e]">{day || "Date needed"} · {printedTotal === null ? "Total needed" : formatDraftAmount(printedTotal, currency)}</p>
                  {(categoryOverride || suggestedCategory) && <p className="mt-0.5 text-xs font-medium text-[#31533c]">{categoryOverride || suggestedCategory}</p>}
                </div>
                <button type="button" aria-expanded={editHeader} onClick={() => setEditHeader(!editHeader)} className="min-h-11 shrink-0 px-2 text-xs font-semibold text-[#31533c] underline">{editHeader ? "Hide details" : "Edit receipt details"}</button>
              </div>
              {editHeader && <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-sm font-medium">Store<input required maxLength={120} className={input} value={store} onChange={(event) => setStore(event.target.value)} /></label>
              <label className="text-sm font-medium">Purchase date<input required type="date" min="1900-01-01" max={localToday()} className={input} value={day} onChange={(event) => setDay(event.target.value)} /></label>
              <label className="text-sm font-medium">Printed total<input required inputMode="decimal" className={input} value={total} onChange={(event) => setTotal(event.target.value)} /></label>
              <label className="text-sm font-medium">Currency
                <select required className={input} value={currency} onChange={(event) => {
                  setCurrency(event.target.value);
                  setQuoteState(null);
                  setError("");
                }}>
                  <option value="" disabled>Choose currency</option>
                  {currency && !supported && <option value={currency} disabled>{currency} · Select the currency</option>}
                  {Object.entries(currencies).map(([code, name]) => <option value={code} key={code}>{code} · {name}</option>)}
                </select>
              </label>
              <label className="col-span-2 text-sm font-medium">Spending category
                <select className={input} value={categoryOverride} onChange={(event) => setCategoryOverride(event.target.value)}>
                  <option value="">Automatic{suggestedCategory ? " · " + suggestedCategory : ""}</option>
                  {expenseCategories.map(([label, value]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              </div>}
              {needsRate && <div role="status" className="mt-2 text-xs text-[#59685e]">
                {quote ? <p>ECB rate · {quote.rate_date} · €1 = {quote.units_per_eur} {currency}</p>
                  : <p>{rateState?.error ?? "Loading the latest exchange rate…"}</p>}
                {(quote || rateState?.error) && <button type="button" className="min-h-10 font-semibold text-[#31533c] underline" onClick={refreshRate}>Refresh rate</button>}
              </div>}
            </section>
            <datalist id="receipt-categories">{["Bakery", "Fruit", "Vegetables", "Dairy desserts", "Dairy", "Drinks", "Eggs", "Meat", "Fish & seafood", "Pantry", ...expenseCategories.map(([, value]) => value)].map((value) => <option value={value} key={value} />)}</datalist>
            <section aria-label="Receipt items" className="overflow-hidden rounded-2xl border border-[#e4e9e2] bg-white">
              <div className="flex justify-between gap-2 border-b border-[#e4e9e2] px-3 py-2 text-xs font-semibold sm:px-4">
                <span>{lines.length} {lines.length === 1 ? "line" : "lines"}</span>
                {unanswered > 0 && <span className="text-amber-900">{unanswered} {unanswered === 1 ? "needs" : "need"} a quick check</span>}
              </div>
              <ul>
                {reviewOrder.map(({ line, index }) => <ReviewLine key={line.key} line={line} number={index + 1} currency={currency}
                  onUpdate={(patch) => updateLine(line.key, patch)}
                  onRemove={() => setLines((current) => current.filter((row) => row.key !== line.key))} />)}
              </ul>
            </section>
            <button type="button" className={secondary} disabled={lines.length >= 300} onClick={() => setLines((current) => [...current, blankLine()])}>+ Add line</button>
          </fieldset>
          <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e4e9e2] bg-white p-4 shadow-sm lg:bottom-4">
            <div className="text-sm">
              <p className="font-semibold">Lines add up to {calculated === null ? "—" : formatDraftAmount(calculated, currency)}</p>
              {convertedTotal !== null && <p className="text-xs font-semibold text-[#31533c]">EUR total · {formatMinor(convertedTotal)}</p>}
              {printedTotal !== null && calculated !== null && calculated !== printedTotal && (
                <p className="text-xs text-red-800">{formatDraftAmount(Math.abs(printedTotal - calculated), currency)} {calculated < printedTotal ? "below" : "above"} the printed total</p>
              )}
              {printedTotal !== null && calculated === null && <p className="text-xs text-amber-900">Fill in missing prices to check the total.</p>}
            </div>
            <button type="submit" className={primary} disabled={Boolean(busy) || !supported || (needsRate && !quote)}>{busy === "save" ? "Saving…" : "Confirm and save"}</button>
            {Boolean(batch?.remaining.length) && <button type="button" disabled={Boolean(busy)} className="min-h-11 px-2 text-xs font-semibold text-[#31533c] underline" onClick={reviewNextReceipt}>Skip to next receipt</button>}
            {error && <p role="status" className="w-full text-xs text-red-800">{error}</p>}
          </div>
        </form>
      )}
    </div>
  );
}

function ReviewLine({ line, number, currency, onUpdate, onRemove }: {
  line: LineEdit;
  number: number;
  currency: string;
  onUpdate: (patch: Partial<LineEdit>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const checkPrice = line.checkPrice;
  const question = line.kind === "product" && line.review;
  const price = readAmount(line.amount);
  const shownPrice = price === null ? "Check price" : formatDraftAmount(line.kind === "discount" ? -price : price, currency);
  const missingAnswer = question && (!line.name.trim() || !line.category.trim());
  const summaryName = line.name || line.original || "New line";

  function done() {
    if (!line.name.trim() || missingAnswer || price === null) return;
    onUpdate({ review: false, checkPrice: false });
    setExpanded(false);
  }

  return (
    <li className="border-b border-[#e4e9e2] last:border-b-0">
      <div className="flex min-h-14 items-center gap-3 px-3 py-2 sm:px-4">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#f1f4ed] text-sm">
          {line.kind === "product" ? productEmoji(line.name, line.category, line.original) : line.kind === "discount" ? "−" : "↩"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold">{summaryName}</p>
          {line.original && line.original !== summaryName && <p className="break-words text-xs text-[#59685e]">{line.original}</p>}
          {line.category && <p className="break-words text-xs text-[#59685e]">{line.category}</p>}
        </div>
        <span className={"shrink-0 text-xs font-semibold tabular-nums sm:text-sm " + (price === null ? "text-amber-900" : "")}>{shownPrice}</span>
        <button type="button" aria-expanded={expanded || question || checkPrice} aria-label={(expanded ? "Hide extra details for line " : "Edit line ") + number}
          onClick={() => setExpanded(!expanded)} className="min-h-11 shrink-0 px-1 text-xs font-semibold text-[#31533c] underline">
          {expanded ? "Hide" : "Edit"}
        </button>
      </div>

      {(question || checkPrice || expanded) && (
        <div className={"mx-2 mb-2 rounded-xl p-3 sm:mx-3 " + (question || checkPrice ? "bg-[#fff8e8]" : "bg-[#f4f7f1]")}>
          {question && <p className="mb-2 text-sm font-semibold text-[#55421f]">What is this product?</p>}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {(question || expanded) && (
              <>
                <label className="col-span-2 text-xs font-medium">Product name
                  <input maxLength={120} className={input} value={line.name} placeholder="e.g. Water"
                    onChange={(event) => onUpdate({ name: event.target.value, aliases: [], remember: question ? line.remember : true })} />
                </label>
                {line.kind === "product" && <label className="col-span-2 text-xs font-medium">Category
                  <input list="receipt-categories" maxLength={60} className={input} value={line.category} placeholder="e.g. Drinks"
                    onChange={(event) => onUpdate({ category: event.target.value, remember: question ? line.remember : true })} />
                </label>}
              </>
            )}
            {(checkPrice || expanded) && (
              <label className="text-xs font-medium">{line.kind === "discount" ? "Discount amount" : "Line total"}
                <input inputMode="decimal" className={input} value={line.amount} onChange={(event) => onUpdate({ amount: event.target.value })} />
              </label>
            )}
            {expanded && (
              <>
                <label className="text-xs font-medium">Kind<select className={input} value={line.kind}
                  onChange={(event) => onUpdate({ kind: event.target.value as LineEdit["kind"] })}>
                  <option value="product">Product</option><option value="discount">Discount</option><option value="deposit">Deposit</option>
                </select></label>
                <label className="col-span-2 text-xs font-medium">Name on receipt<input maxLength={240} className={input} value={line.original}
                  onChange={(event) => onUpdate({ original: event.target.value })} /></label>
                {line.kind !== "discount" && (
                  <>
                    <label className="text-xs font-medium">Quantity (optional)<input inputMode="decimal" className={input} value={line.quantity}
                      onChange={(event) => onUpdate({ quantity: event.target.value })} /></label>
                    <label className="text-xs font-medium">Unit<select className={input} value={line.unit}
                      onChange={(event) => onUpdate({ unit: event.target.value as LineEdit["unit"] })}>
                      <option value="unit">Count</option><option value="kg">kg</option><option value="L">L</option>
                    </select></label>
                  </>
                )}
              </>
            )}
          </div>
          {line.kind === "product" && (question || expanded) && (
            <label className="mt-1 flex min-h-11 items-center gap-2 text-xs text-[#59685e]">
              <input type="checkbox" checked={line.remember} onChange={(event) => onUpdate({ remember: event.target.checked })} />
              Remember for next time at this store
            </label>
          )}
          <div className="flex items-center justify-between gap-2">
            {expanded ? <button type="button" aria-label={"Remove line " + number} className="min-h-11 px-2 text-xs font-semibold text-red-800" onClick={onRemove}>Remove line</button> : <span />}
            <button type="button" disabled={!line.name.trim() || missingAnswer || price === null} onClick={done}
              className="min-h-11 rounded-lg border border-[#dce4d9] bg-white px-3 text-xs font-semibold text-[#31533c] disabled:opacity-50">
              Done
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
