"use client";

import { createClient, type Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ManualEntry } from "@/lib/ledger";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const publicApi = process.env.NEXT_PUBLIC_LUMA_API_URL;
const apiUrl = !publicApi || /^http:\/\/(localhost|127\.0\.0\.1):8000\/?$/.test(publicApi) ? "/ledger-api" : publicApi;
export const supabase = url && key ? createClient(url, key, { auth: { flowType: "pkce" } }) : null;

export type LedgerData = { entries: ManualEntry[]; monthStartDay: number };
type RemoteState = { owner: string; data?: LedgerData; error?: string };
type Account = {
  session: Session | null;
  ready: boolean;
  remote: RemoteState | null;
  retry: () => void;
  refreshLedger: () => void;
  create: (entry: Omit<ManualEntry, "id">) => Promise<void>;
  remove: (id: string) => Promise<void>;
  changeDay: (day: number) => Promise<void>;
};

const AccountContext = createContext<Account | null>(null);

export async function accountRequest<T>(session: Session, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", "Bearer " + session.access_token);
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
  const res = await fetch(apiUrl.replace(/\/$/, "") + "/v1/" + path, { ...init, cache: "no-store", headers });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(res.status === 401 ? "Your session has expired. Sign in again." :
      typeof payload?.detail === "string" ? payload.detail : "Check the receipt fields and try again.");
  }
  return res.status === 204 ? undefined as T : await res.json();
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabase);
  const [remote, setRemote] = useState<RemoteState | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) setRemote(null);
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
      () => { if (!controller.signal.aborted) setRemote({ owner, error: "Could not load your private ledger." }); },
    );
    return () => controller.abort();
  }, [session, refresh]);

  const activeRemote = remote?.owner === session?.user.id ? remote : null;
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
      refreshLedger: () => setRefresh((count) => count + 1),
      retry: () => { setRemote(null); setRefresh((count) => count + 1); },
      create: async (entry) => {
        const active = requireLedger();
        const saved = await accountRequest<ManualEntry>(active, "transactions", { method: "POST", body: JSON.stringify(entry) });
        updateFor(active.user.id, (data) => ({ ...data, entries: [saved, ...data.entries.filter((row) => row.id !== saved.id)] }));
      },
      remove: async (id) => {
        const active = requireLedger();
        await accountRequest(active, "transactions/" + encodeURIComponent(id), { method: "DELETE" });
        updateFor(active.user.id, (data) => ({ ...data, entries: data.entries.filter((row) => row.id !== id) }));
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
