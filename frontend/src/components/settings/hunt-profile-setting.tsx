"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { accountRequest, useAccount } from "@/components/account/account-provider";
import { useHunt, type HuntProfile } from "@/lib/use-hunt";

export function HuntProfileSetting() {
  const { session } = useAccount();
  const { data, error, retry, setData } = useHunt<HuntProfile>("hunt/profile");
  const [draft, setDraft] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const username = draft ?? data?.username ?? "";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || pending) return;
    const value = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(value)) {
      setFeedback({ text: "Use 3–20 letters, numbers, or underscores.", error: true });
      return;
    }
    setFeedback(null);
    setPending(true);
    try {
      setData(await accountRequest<HuntProfile>(session, "hunt/profile", { method: "PUT", body: JSON.stringify({ username: value }) }));
      setDraft(null);
      setFeedback({ text: "Hunt username saved." });
    } catch (reason) {
      setFeedback({ text: reason instanceof Error ? reason.message : "Could not save your Hunt username.", error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <section id="hunt-profile" className="scroll-mt-5 rounded-2xl border border-[#ddd3f0] bg-white">
      <h2 className="border-b border-[#eee8f7] px-4 py-3 text-sm font-semibold text-[#54327c] sm:px-5">Oopsie Hunt profile</h2>
      <div className="p-4 sm:p-5">
        {error ? <p role="alert" className="text-sm text-[#744359]">{error} <button type="button" onClick={retry} className="min-h-11 px-1 font-semibold underline">Retry</button></p>
          : !data ? <p role="status" className="text-sm text-[#59685e]">Loading your Hunt profile…</p>
          : <form onSubmit={save}>
            <label className="block text-sm font-medium">
              Hunt username
              <input required name="huntUsername" value={username} maxLength={20} autoCapitalize="none" autoComplete="off" spellCheck={false}
                disabled={pending} className="mt-2 min-h-11 w-full rounded-xl border border-[#ddd3f0] px-3 py-2 text-base"
                onChange={(event) => { setDraft(event.target.value); setFeedback(null); }} />
            </label>
            <p className="mt-1 text-xs text-[#59685e]">Other Hunt players can see your username. Use 3–20 letters, numbers, or underscores.</p>
            <p className="mt-2 break-all text-xs text-[#59685e]">Player ID <span className="font-mono">{data.player_id}</span></p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button disabled={pending || !username.trim() || username.trim().toLowerCase() === data.username}
                className="min-h-11 rounded-xl bg-[#54327c] px-4 text-sm font-semibold text-white disabled:opacity-50">
                {pending ? "Saving…" : "Save Hunt username"}
              </button>
              {data.username && <Link href="/hunt" className="inline-flex min-h-11 items-center text-sm font-semibold text-[#54327c]">Enter Hunt →</Link>}
            </div>
            {feedback && <p role={feedback.error ? "alert" : "status"} className={feedback.error ? "mt-2 text-sm text-red-800" : "mt-2 text-sm text-[#31533c]"}>{feedback.text}</p>}
          </form>}
      </div>
    </section>
  );
}
