"use client";

import { useEffect, useState } from "react";
import { accountRequest, useAccount } from "@/components/account/account-provider";
import type { Receipt } from "./receipts";

export function useReceipts() {
  const { session } = useAccount();
  const [state, setState] = useState<{ records?: Receipt[]; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    void accountRequest<Receipt[]>(session, "receipts", { signal: controller.signal }).then(
      (records) => { if (!controller.signal.aborted) setState({ records }); },
      (error: unknown) => { if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : "Could not load receipts." }); },
    );
    return () => controller.abort();
  }, [session, attempt]);
  return { ...state, retry: () => { setState({}); setAttempt((value) => value + 1); } };
}
