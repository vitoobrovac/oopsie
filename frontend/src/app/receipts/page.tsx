import { Suspense } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { ReceiptLibrary } from "@/components/receipts/receipt-library";

export default function ReceiptsPage() { return <PageShell requiresLedger={false}><Suspense fallback={<div className="text-sm text-[#718078]">Loading receipts…</div>}><ReceiptLibrary /></Suspense></PageShell>; }
