"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { BrandLogo } from "@/components/layout/brand-logo";
import { Icon } from "@/components/layout/icon";
import { dismissModal, Modal } from "@/components/layout/modal";
import { accountRequest, useAccount } from "@/components/account/account-provider";
import { HuntLevelBadge, HuntNotice, LifetimeLeaderboard, PermanentChallenges } from "@/components/features/hunt-achievements";
import { formatReceiptDate } from "@/lib/finance-format";
import { useHunt, type HuntAchievements, type HuntLobby } from "@/lib/use-hunt";

const panel = "rounded-3xl border border-[#392c53] bg-[#1d162e] p-4 sm:p-6";
const action = "inline-flex min-h-11 items-center justify-center rounded-xl bg-[#e0f887] px-4 text-sm font-bold text-[#20291a]";
const secondary = "inline-flex min-h-11 items-center justify-center rounded-xl border border-[#4c3b66] px-3 text-sm font-semibold text-[#eee3fc]";

export default function HuntPage() {
  const { session } = useAccount();
  return <HuntLobbyPage key={session?.user.id} />;
}

function HuntLobbyPage() {
  const { session } = useAccount();
  const { data, error, retry } = useHunt<HuntLobby>("hunt/lobby");
  const [view, setView] = useState<"week" | "challenges" | "leaderboard" | "players">("week");
  const [rules, setRules] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimError, setClaimError] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [celebration, setCelebration] = useState<{ xp: number; level: number | null } | null>(null);
  const rulesTitle = useId();
  const joined = Boolean(data?.profile.username);
  const week = data?.week;
  const achievements = useHunt<HuntAchievements>("hunt/achievements", joined);
  const player = achievements.data?.player;
  const readyRewards = achievements.data?.challenges.reduce((count, challenge) => count + challenge.tiers.filter(
    (tier) => !tier.claimed && challenge.progress >= tier.target,
  ).length, 0) ?? 0;

  async function claim(id: string, tier: number) {
    if (!session || claiming) return;
    setClaimError("");
    setCelebration(null);
    setClaiming(id);
    try {
      const updated = await accountRequest<HuntAchievements>(session, "hunt/achievements/claim", {
        method: "POST", body: JSON.stringify({ challenge_id: id, tier }),
      });
      achievements.setData(updated);
      if (updated.awarded_xp) setCelebration({
        xp: updated.awarded_xp, level: player && updated.player.level > player.level ? updated.player.level : null,
      });
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : "Could not claim this reward. Try again.");
    } finally {
      setClaiming(null);
    }
  }

  async function joinWeek() {
    if (!session || !week || joining) return;
    setJoining(true);
    setJoinError("");
    try {
      const updated = await accountRequest<HuntAchievements>(session, "hunt/join", {
        method: "POST", body: JSON.stringify({ starts_on: week.starts_on }),
      });
      achievements.setData(updated);
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "Could not join this Hunt. Try again.");
    } finally {
      setJoining(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#130e20] text-[#f7f1ff]">
      <div className="mx-auto max-w-5xl px-4 pb-12 sm:px-7">
        <header className="flex min-h-16 items-center justify-between gap-3">
          <Link href="/" className={secondary}>← Exit Hunt</Link>
          <button type="button" onClick={() => setRules(true)} className={secondary}>Hunt rules</button>
        </header>

        <section className="relative isolate overflow-hidden rounded-3xl border border-[#60468d] bg-linear-to-br from-[#542a87] via-[#322054] to-[#1e1736] px-5 py-8 sm:px-9 sm:py-12">
          <div aria-hidden="true" className="pointer-events-none absolute -right-14 -top-28 -z-10 size-88 rounded-full border border-white/15 shadow-[0_0_0_25px_#ffffff08,0_0_0_55px_#ffffff06]" />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-balance text-5xl font-black leading-[0.95] tracking-[-0.075em] sm:text-7xl">Oopsie <span className="block text-[#e0f887]">Hunt</span></h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-[#e1d6f7]">Weekly shopping missions for things you already buy.</p>
            </div>
            <div className="oopsie-float grid size-24 shrink-0 place-items-center rounded-3xl border border-white/20 bg-white/10 sm:size-36">
              <BrandLogo />
            </div>
          </div>
        </section>

        {error ? <div role="alert" className={panel + " mt-4"}>
          <p className="text-sm">{error}</p><button type="button" onClick={retry} className={secondary + " mt-3"}>Retry</button>
        </div> : !data ? (
          <p role="status" className={panel + " mt-4 text-sm"}>Loading the Hunt lobby…</p>
        ) : !joined ? (
          <section className={panel + " mt-4"}>
            <h2 className="text-xl font-bold">Choose your player name</h2>
            <p className="mt-2 text-sm text-[#d6c8e9]">Save a unique username in Settings to enter the Hunt and see other players.</p>
            <Link href="/settings#hunt-profile" className={action + " mt-4"}>Choose a username</Link>
          </section>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#392c53] bg-[#1d162e] px-4 py-2">
              <span className="min-w-0 break-all text-sm font-bold text-[#e0f887]">@{data.profile.username}</span>
              {player && <div className="flex items-center gap-2 text-xs font-semibold text-[#e1d6f7]">
                <HuntLevelBadge level={player.level} />
                <p>{player.xp.toLocaleString("en")} XP · #{player.rank} lifetime</p>
              </div>}
              <Link href="/settings#hunt-profile" className="inline-flex min-h-11 items-center text-sm font-medium text-[#ddd0f1] underline">Player settings</Link>
            </div>
            <div role="group" aria-label="Hunt view" className="my-4 flex flex-wrap gap-2">
              {([["week", "Weekly hunt"], ["challenges", "Permanent challenges"], ["leaderboard", "Leaderboard"], ["players", "Players"]] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}
                  className={(view === value ? action : secondary) + " gap-2"}>
                  {label}
                  {value === "challenges" && readyRewards > 0 && (
                    <span className="rounded-full bg-[#493365] px-2 py-0.5 text-xs text-[#f6df8e]" aria-label={readyRewards + " rewards ready"}>{readyRewards}</span>
                  )}
                </button>
              ))}
            </div>
            {celebration && <HuntNotice key={celebration.xp + ":" + player?.xp} className="mb-4 flex items-center gap-3 rounded-2xl border border-[#799547] bg-[#34432b] px-4 py-3 text-sm font-bold text-[#e0f887]">
              <span aria-hidden="true" className="oopsie-hunt-star text-xl">★</span>
              <span>+{celebration.xp.toLocaleString("en")} XP claimed{celebration.level ? " · Level " + celebration.level + " reached!" : ""}</span>
            </HuntNotice>}
            {claimError && <p role="alert" className="mb-4 rounded-xl bg-[#4d2b49] px-4 py-3 text-sm">{claimError}</p>}
            {view === "week" ? (
              <section className={panel}>
                <h2 className="text-2xl font-bold">{week?.title ?? "No hunt scheduled this week"}</h2>
                {week && <>
                  <p className="mt-1 text-xs font-semibold text-[#c7a8f0]">{formatReceiptDate(week.starts_on)} – {formatReceiptDate(new Date(Date.parse(week.ends_on) - 86_400_000).toISOString())}</p>
                  <p className="mt-2 text-sm text-[#d6c8e9]">{week.description}</p>
                  {achievements.data && (achievements.data.joined_week === week.starts_on
                    ? <p className="mt-3 text-sm font-semibold text-[#e0f887]">You’ve joined this week’s Hunt.</p>
                    : <button type="button" onClick={joinWeek} disabled={joining} className={action + " mt-3 disabled:opacity-60"}>
                      {joining ? "Joining…" : "Join this week’s Hunt"}
                    </button>)}
                  {joinError && <p role="alert" className="mt-2 text-sm text-[#f6df8e]">{joinError}</p>}
                  <ul className={"mt-4 grid gap-2 " + (week.type === "bingo" ? "grid-cols-3" : "sm:grid-cols-2")}>
                    {week.objectives.map(({ label, detail }) => (
                      <li key={label} className={week.type === "bingo" ? "min-w-0 rounded-xl bg-[#2a2040] p-2 text-center [overflow-wrap:anywhere]" : "flex items-center gap-3 rounded-xl bg-[#2a2040] p-3"}>
                        {week.type !== "bingo" && <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#3c3153] text-[#e0f887]"><Icon name="target" className="size-5" /></span>}
                        <span><span className="block text-sm font-bold">{label}</span><span className="block text-xs text-[#d6c8e9]">{detail}</span></span>
                      </li>
                    ))}
                  </ul>
                </>}
                <p className="mt-4 text-xs text-[#d6c8e9]">The lobby is open. Receipt verification and competitive scoring are still in development.</p>
              </section>
            ) : view === "players" ? (
              <section className={panel}>
                <h2 className="text-xl font-bold">Hunt players <span className="ml-1 text-sm font-medium text-[#d6c8e9]">({data.player_count})</span></h2>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {data.players.map((username) => (
                    <li key={username} className="flex min-w-0 items-center gap-3 rounded-xl bg-[#2a2040] px-3 py-2 text-sm">
                      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#4d3674] font-bold uppercase text-[#e0f887]">{username[0]}</span>
                      <span className="min-w-0 break-all font-medium">@{username}</span>
                    </li>
                  ))}
                </ul>
                {data.player_count > data.players.length && <p className="mt-3 text-xs text-[#d6c8e9]">Showing the first {data.players.length} usernames alphabetically.</p>}
              </section>
            ) : achievements.error ? (
              <div role="alert" className={panel}><p className="text-sm">{achievements.error}</p>
                <button type="button" onClick={achievements.retry} className={secondary + " mt-3"}>Retry</button>
              </div>
            ) : !achievements.data ? (
              <p role="status" className={panel + " text-sm"}>Loading Hunt progress…</p>
            ) : view === "challenges" ? (
              <PermanentChallenges data={achievements.data} pending={claiming} ready={readyRewards} onClaim={claim} />
            ) : (
              <div className={panel}><LifetimeLeaderboard data={achievements.data} /></div>
            )}
          </>
        )}
      </div>
      {rules && <Modal titleId={rulesTitle} onClose={() => setRules(false)} placement="sheet">
        <h2 id={rulesTitle} className="text-xl font-bold text-[#392c53]">Hunt rules</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[#473d50]">
          <li>Shop for things you already need.</li>
          <li>Competitive points will come from verified scans. Manual entries and personal receipt edits stay out of the competition.</li>
          <li>Permanent challenges award lifetime XP and levels. Weekly Hunt Points are scored separately.</li>
          <li>Your username is visible to other players. Your ledger and receipt images stay private.</li>
        </ul>
        <button type="button" onClick={dismissModal} className={action + " mt-4 w-full"}>Got it</button>
      </Modal>}
    </main>
  );
}
