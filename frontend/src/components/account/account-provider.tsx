"use client";

import { createClient, type Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ManualEntry } from "@/lib/ledger";
import type { GoalAllocation } from "@/lib/goal-savings";
import type { Receipt } from "@/lib/receipts";
import { deleteLocalSubscriptionEntry, localPlanningKey, localSubscriptionEntries, useLocalPlanning } from "@/lib/local-planning";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const publicApi = process.env.NEXT_PUBLIC_LUMA_API_URL;
const apiUrl = !publicApi || /^http:\/\/(localhost|127\.0\.0\.1):8000\/?$/.test(publicApi) ? "/ledger-api" : publicApi;
export const supabase = url && key ? createClient(url, key, { auth: { flowType: "pkce" } }) : null;

export type LedgerData = { entries: ManualEntry[]; monthStartDay: number; goalAllocations?: GoalAllocation[] };
type RemoteState = { owner: string; data?: LedgerData; error?: string };
type ReceiptState = { owner: string; records?: Receipt[]; error?: string };
type Account = {
  session: Session | null;
  ready: boolean;
  displayName: string;
  changeDisplayName: (name: string) => Promise<void>;
  weekStartDay: number;
  changeWeekStartDay: (day: number) => Promise<void>;
  remote: RemoteState | null;
  previewEntries: ManualEntry[];
  retry: () => void;
  ledgerRevision: number;
  refreshLedger: () => void;
  receipts: ReceiptState | null;
  loadReceipts: () => void;
  retryReceipts: () => void;
  receiptSaved: () => void;
  create: (entry: Omit<ManualEntry, "id">) => Promise<void>;
  remove: (id: string) => Promise<void>;
  changeDay: (day: number) => Promise<void>;
};

const noPreviewEntries: ManualEntry[] = [];
const AccountContext = createContext<Account | null>(null);

function isWeekday(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7;
}

async function fetchRead(endpoint: string, options: RequestInit) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timeout = setTimeout(cancel, 15000);
  try {
    return await fetch(endpoint, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
  }
}

export async function accountFetch(session: Session, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", "Bearer " + session.access_token);
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
  const endpoint = apiUrl.replace(/\/$/, "") + "/v1/" + path;
  const retryRead = !init?.method || init.method === "GET";
  const options = { ...init, cache: "no-store" as const, headers };
  const started = Date.now();
  while (true) {
    let res: Response | undefined;
    try {
      res = retryRead ? await fetchRead(endpoint, options) : await fetch(endpoint, options);
    } catch (error) {
      if (!retryRead || init?.signal?.aborted) throw error;
    }
    const contentType = res?.headers.get("content-type") ?? "";
    const apiResponse = res?.status === 204 || /application\/(?:json|x-ndjson)\b/.test(contentType);
    if (res && apiResponse) return checkedResponse(res);
    void res?.body?.cancel().catch(() => undefined);
    if (!retryRead || Date.now() - started >= 60000) {
      throw new Error("Oopsie’s server didn’t respond. Check your connection and try again.");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
  }
}

async function checkedResponse(res: Response) {
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(res.status === 401 ? "Your session has expired. Sign in again." :
      typeof payload?.detail === "string" ? payload.detail : "Oopsie couldn’t complete this request.");
  }
  return res;
}

export async function accountRequest<T>(session: Session, path: string, init?: RequestInit): Promise<T> {
  const res = await accountFetch(session, path, init);
  return res.status === 204 ? undefined as T : await res.json();
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabase);
  const [remote, setRemote] = useState<RemoteState | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [receiptRequest, setReceiptRequest] = useState<{ owner: string; started: number } | null>(null);
  const [receiptRevision, setReceiptRevision] = useState(0);
  const [receipts, setReceipts] = useState<ReceiptState | null>(null);
  const [preview, setPreview] = useState<{ owner: string; entries: ManualEntry[] } | null>(null);
  const owner = session?.user.id;
  useEffect(() => {
    if (!useLocalPlanning || !owner) return;
    function syncPreview() {
      if (!owner) return;
      try {
        setPreview({ owner, entries: localSubscriptionEntries(owner) });
      } catch {
        setPreview({ owner, entries: noPreviewEntries });
      }
    }
    function onStorage(event: StorageEvent) {
      if (owner && (event.key === null || event.key === localPlanningKey(owner))) syncPreview();
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", syncPreview);
    const sync = window.setTimeout(syncPreview, 0);
    return () => {
      window.clearTimeout(sync);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", syncPreview);
    };
  }, [owner, refresh]);
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setRemote(null);
        setReceipts(null);
        setReceiptRequest(null);
      }
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const owner = session.user.id;
    void accountRequest<LedgerData>(session, "ledger", { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) setRemote({ owner, data }); },
      (error: unknown) => {
        if (!controller.signal.aborted) setRemote((current) => current?.owner === owner && current.data
          ? current
          : { owner, error: error instanceof Error ? error.message : "Could not load your private ledger." });
      },
    );
    return () => controller.abort();
  }, [session, refresh]);

  useEffect(() => {
    if (!session || receiptRequest?.owner !== session.user.id) return;
    const receiptOwner = receiptRequest.owner;
    const controller = new AbortController();
    void accountRequest<Receipt[]>(session, "receipts", { signal: controller.signal }).then(
      (records) => {
        if (!controller.signal.aborted) setReceipts({ owner: receiptOwner, records });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setReceipts({ owner: receiptOwner,
          error: error instanceof Error ? error.message : "Could not load receipts." });
      },
    );
    return () => controller.abort();
  }, [session, receiptRequest, receiptRevision]);

  const loadReceipts = useCallback(() => {
    if (!owner) return;
    const started = Date.now();
    setReceiptRequest((current) => current?.owner === owner && started - current.started < 45000
      ? current
      : { owner, started });
  }, [owner]);
  function retryReceipts() {
    setReceipts(null);
    setReceiptRevision((revision) => revision + 1);
  }

  const activeRemote = remote?.owner === session?.user.id ? remote : null;
  const savedWeekStart: unknown = session?.user.user_metadata?.week_start_day;
  function updateFor(owner: string, update: (data: LedgerData) => LedgerData) {
    setRemote((current) => current?.owner === owner && current.data ? { owner, data: update(current.data) } : current);
    setRefresh((count) => count + 1);
  }

  function requireLedger() {
    if (!session || !activeRemote?.data) throw new Error("Wait for your ledger to load, then try again.");
    return session;
  }

  return (
    <AccountContext.Provider value={{
      session, ready, remote: activeRemote,
      displayName: typeof session?.user.user_metadata?.display_name === "string" ? session.user.user_metadata.display_name : "",
      changeDisplayName: async (name) => {
        if (!session || !supabase) throw new Error("Sign in to update your profile.");
        const cleaned = name.trim();
        if (cleaned.length > 60) throw new Error("Use at most 60 characters.");
        const { error } = await supabase.auth.updateUser({ data: { display_name: cleaned } });
        if (error) throw error;
      },
      weekStartDay: isWeekday(savedWeekStart) ? savedWeekStart : 1,
      changeWeekStartDay: async (day) => {
        if (!session || !supabase) throw new Error("Sign in to update your reporting preferences.");
        if (!isWeekday(day)) throw new Error("Choose a day of the week.");
        const { error } = await supabase.auth.updateUser({ data: { week_start_day: day } });
        if (error) throw error;
      },
      previewEntries: preview && preview.owner === owner ? preview.entries : noPreviewEntries,
      ledgerRevision: refresh,
      refreshLedger: () => setRefresh((count) => count + 1),
      receipts: receipts?.owner === owner ? receipts : null,
      loadReceipts,
      retryReceipts,
      receiptSaved: () => {
        setRefresh((count) => count + 1);
        setReceiptRevision((count) => count + 1);
      },
      retry: () => { setRemote(null); setRefresh((count) => count + 1); },
      create: async (entry) => {
        const active = requireLedger();
        const saved = await accountRequest<ManualEntry>(active, "transactions", { method: "POST", body: JSON.stringify(entry) });
        updateFor(active.user.id, (data) => ({ ...data, entries: [saved, ...data.entries.filter((row) => row.id !== saved.id)] }));
      },
      remove: async (id) => {
        if (useLocalPlanning && owner && id.startsWith("local-subscription:")) {
          deleteLocalSubscriptionEntry(owner, id);
          setPreview({ owner, entries: localSubscriptionEntries(owner) });
          return;
        }
        const active = requireLedger();
        await accountRequest(active, "transactions/" + encodeURIComponent(id), { method: "DELETE" });
        updateFor(active.user.id, (data) => ({ ...data, entries: data.entries.filter((row) => row.id !== id) }));
        setReceipts((current) => current?.owner === active.user.id && current.records
          ? { ...current, records: current.records.filter((receipt) => receipt.id !== id) }
          : current);
        setReceiptRevision((count) => count + 1);
      },
      changeDay: async (day) => {
        const active = requireLedger();
        await accountRequest(active, "preferences", { method: "PUT", body: JSON.stringify({ monthStartDay: day }) });
        updateFor(active.user.id, (data) => ({ ...data, monthStartDay: day }));
      },
    }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const account = useContext(AccountContext);
  if (!account) throw new Error("AccountProvider is required.");
  return account;
}
