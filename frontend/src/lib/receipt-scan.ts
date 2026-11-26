import type { Session } from "@supabase/supabase-js";
import { accountFetch } from "@/components/account/account-provider";
import type { ReceiptDraft } from "./receipts";

export const scanStages = {
  upload: { percent: 0, label: "Sending the photo…" },
  preparing: { percent: 15, label: "Preparing the photo…" },
  reading: { percent: 35, label: "Reading names and prices…" },
  separating: { percent: 50, label: "Separating receipts…" },
  parsing: { percent: 68, label: "Analysing receipt lines…" },
  matching: { percent: 83, label: "Matching products…" },
  checking: { percent: 94, label: "Checking remembered names…" },
  ready: { percent: 100, label: "Scan complete" },
} as const;

export type ScanStage = keyof typeof scanStages;

type ScanEvent =
  | { type: "stage"; stage: ScanStage }
  | { type: "result"; draft: ReceiptDraft }
  | { type: "error"; message: string; code?: string };

export class ReceiptRecognitionError extends Error {}

export function needsScanFeedback(draft: ReceiptDraft) {
  return [draft, ...(draft.additional_receipts ?? [])].some(({ lines, total_minor }) => {
    const products = lines.filter(({ kind }) => kind === "product");
    const missed = products.filter(({ review, amount_minor }) => review || amount_minor === null).length;
    const lineTotal = lines.reduce((sum, { amount_minor }) => sum + (amount_minor ?? 0), 0);
    const incomplete = missed > 0 || (total_minor !== null && lineTotal !== total_minor);
    return products.length === 0 || missed > 2 || (incomplete && products.length - missed <= 2);
  });
}

export async function scanReceipt(session: Session, file: File, onStage: (stage: ScanStage) => void) {
  const response = await accountFetch(session, "receipts/analyze", {
    method: "POST", body: file,
    headers: { "Content-Type": file.type || "application/octet-stream", Accept: "application/x-ndjson" },
  });
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    return await response.json() as ReceiptDraft;
  }
  if (!response.body) throw new Error("The scan response was empty. Try again.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = done ? "" : lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event: ScanEvent = JSON.parse(line);
        if (event.type === "error") {
          if (event.code === "receipt_unreadable") throw new ReceiptRecognitionError(event.message);
          throw new Error(event.message);
        }
        if (event.type === "stage" && event.stage !== "ready" && Object.hasOwn(scanStages, event.stage)) onStage(event.stage);
        if (event.type === "result") return event.draft;
      }
      if (done) throw new Error("The scan ended before the receipt was ready. Try again.");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
