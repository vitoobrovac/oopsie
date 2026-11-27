"use client";

import { useEffect } from "react";
import { useAccount } from "@/components/account/account-provider";

export function useReceipts() {
  const { receipts, loadReceipts, retryReceipts } = useAccount();
  useEffect(() => { loadReceipts(); }, [loadReceipts]);
  return { records: receipts?.records, error: receipts?.error, retry: retryReceipts };
}
