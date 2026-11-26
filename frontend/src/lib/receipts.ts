
export type ReceiptLine = {
  kind: "product" | "discount" | "deposit";
  receipt_name: string;
  display_name: string;
  category: string;
  aliases: string[];
  quantity: number | string | null;
  unit: "unit" | "kg" | "L";
  amount_minor: number | null;
};

export type ReceiptDraft = {
  store: string | null;
  date: string | null;
  currency: string | null;
  total_minor: number | null;
  spending_category?: string;
  lines: (ReceiptLine & { review: boolean })[];
  warnings: string[];
  additional_receipts?: ReceiptDraft[];
};

export type Receipt = {
  id: string;
  store: string;
  purchased_on: string;
  currency: "EUR";
  total_minor: number;
  lines: (ReceiptLine & { position: number; amount_minor: number })[];
};

export function groupProducts(receipts: Receipt[]) {
  const groups = new Map<string, { receipt: Receipt; item: Receipt["lines"][number] }[]>();
  for (const receipt of receipts) {
    for (const item of receipt.lines) {
      if (item.kind !== "product") continue;
      const key = searchText(item.display_name);
      const purchases = groups.get(key) ?? [];
      purchases.push({ receipt, item });
      groups.set(key, purchases);
    }
  }
  return [...groups].map(([key, purchases]) => ({
    key, name: purchases[0].item.display_name, purchases,
    terms: searchText(purchases.flatMap(({ item }) => [item.display_name, item.receipt_name, item.category, ...item.aliases]).join(" ")),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function searchText(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function newReceiptId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
