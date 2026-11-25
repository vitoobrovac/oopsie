"use client";

import { useMemo } from "react";
import { useAccount, type LedgerData } from "@/components/account/account-provider";
import { ledgerReport } from "./ledger";

const emptyLedger: LedgerData = { entries: [], monthStartDay: 1 };

export function localToday() {
  const date = new Date();
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString().slice(0, 10);
}

export function useLedger() {
  const account = useAccount();
  const data = account.remote?.data ?? emptyLedger;
  const today = localToday();
  const report = useMemo(() => ledgerReport([...data.entries, ...account.previewEntries], data.monthStartDay, today), [data, account.previewEntries, today]);
  return {
    monthStartDay: data.monthStartDay, report, canWrite: Boolean(account.remote?.data),
    saveEntry: account.create, deleteEntry: account.remove, saveMonthStartDay: account.changeDay,
  };
}
