"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/layout/icon";
import type { HuntAchievement, HuntAchievements } from "@/lib/use-hunt";

const icons: Record<string, IconName> = {
  receipt: "cart", wallet: "wallet", target: "target", camera: "camera", calendar: "calendar",
  "arrow-down": "arrow-down", cart: "cart", grid: "grid", sparkles: "sparkles",
};
type Claim = (id: string, tier: number) => void;

export function HuntLevelBadge({ level }: { level: number }) {
  return <span title={"Level " + level} className="inline-grid size-9 shrink-0 place-items-center rounded-full border border-[#b3cc65] bg-[#36432b] text-sm font-black tabular-nums text-[#e0f887]">
    <span className="sr-only">Level </span>{level}
  </span>;
}

export function HuntNotice({ children, className }: { children: ReactNode; className: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, []);
  return visible && <div role="status" className={className}>{children}</div>;
}

export function PermanentChallenges({ data, pending, ready, onClaim }: {
  data: HuntAchievements; pending: string | null; ready: number; onClaim: Claim;
}) {
  return (
    <section aria-labelledby="permanent-challenges-title">
      <h2 id="permanent-challenges-title" className="text-2xl font-bold">Permanent challenges</h2>
      <p className="mt-1 text-sm text-[#d6c8e9]">Progress never resets. Rewards go toward your lifetime XP.</p>
      {ready > 0 && <HuntNotice className="mt-3 rounded-xl bg-[#36264c] px-3 py-2 text-sm font-semibold text-[#f6df8e]">
        {ready === 1 ? "Achievement unlocked! One reward is ready to claim." : ready + " achievement rewards are ready to claim."}
      </HuntNotice>}
      <div className="mt-3 space-y-2">
        {data.challenges.map((challenge) => (
          <ChallengeCard key={challenge.id} challenge={challenge} pending={pending} onClaim={onClaim} />
        ))}
      </div>
      {Boolean(data.upcoming?.length) && <section aria-labelledby="upcoming-hunt-challenges" className="mt-6">
        <h3 id="upcoming-hunt-challenges" className="text-lg font-bold">Upcoming challenges</h3>
        <p className="mt-1 text-sm text-[#d6c8e9]">These open as verified scanning and weekly scoring become available.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {data.upcoming?.map(({ id, name, description, icon, tiers }) => (
            <article key={id} className="rounded-xl border border-[#4c3b66] bg-[#251b37] px-3 py-2">
              <h4 className="flex items-center gap-2 font-bold"><Icon name={icons[icon] ?? "sparkles"} className="size-4 text-[#c7a8f0]" />{name}</h4>
              <p className="mt-1 text-xs text-[#d6c8e9]">{description}</p>
              <TierRewards name={name} tiers={tiers} />
            </article>
          ))}
        </div>
      </section>}
    </section>
  );
}

function ChallengeCard({ challenge, pending, onClaim }: {
  challenge: HuntAchievement; pending: string | null; onClaim: Claim;
}) {
  const next = challenge.tiers.find((tier) => !tier.claimed);
  const target = next?.target ?? challenge.tiers.at(-1)?.target ?? 1;

  return (
    <article className="min-w-0 rounded-xl border border-[#4c3b66] bg-[#251b37] px-3 py-2">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#493365] text-[#e0f887]">
          <Icon name={icons[challenge.icon] ?? "sparkles"} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold">{challenge.name}</h3>
          <p className="text-xs text-[#d6c8e9]">{challenge.description}</p>
        </div>
        <ol aria-label={challenge.name + " stars"} className="flex shrink-0 gap-0.5">
          {challenge.tiers.map(({ tier, target, claimed }) => {
            const unlocked = challenge.progress >= target;
            return <li key={tier} className={claimed ? "text-[#e0f887]" : unlocked ? "text-[#f6df8e]" : "text-[#a78dbd]"}>
              <span aria-hidden="true">{claimed || unlocked ? "★" : "☆"}</span>
              <span className="sr-only">Tier {tier} {claimed ? "claimed" : unlocked ? "ready to claim" : "locked"}</span>
            </li>
          })}
        </ol>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap justify-between gap-x-2 text-[11px] font-semibold text-[#e1d6f7]">
            <span>{next ? "Tier " + next.tier + " / 3" : "Complete"}</span>
            <span className="tabular-nums">{challenge.progress} / {target}</span>
          </div>
          <progress className="block h-1.5 w-full accent-[#e0f887]" aria-label={challenge.name + " progress"}
            value={Math.min(challenge.progress, target)} max={target} />
        </div>
        {next && (challenge.progress >= target
          ? <button type="button" disabled={pending !== null} onClick={() => onClaim(challenge.id, next.tier)}
              aria-label={"Claim " + challenge.name + " tier " + next.tier + ": " + next.xp + " XP"}
              className="min-h-11 shrink-0 rounded-lg bg-[#e0f887] px-2.5 text-xs font-bold text-[#20291a] disabled:opacity-60">
              {pending === challenge.id ? "Claiming…" : "Claim " + next.xp.toLocaleString("en") + " XP"}
            </button>
          : <span className="shrink-0 rounded-lg bg-[#493365] px-2 py-1 text-xs font-semibold text-[#f6df8e]">{next.xp.toLocaleString("en")} XP</span>)}
      </div>
      <TierRewards name={challenge.name} tiers={challenge.tiers} />
    </article>
  );
}

function TierRewards({ name, tiers }: { name: string; tiers: { tier: number; target: number; xp: number }[] }) {
  return <details className="mt-1 text-[11px] text-[#d6c8e9]">
    <summary className="w-fit cursor-pointer py-1" aria-label={name + " tier rewards"}>Tier rewards</summary>
    <ol className="mt-1 grid grid-cols-3 gap-1.5">
      {tiers.map(({ tier, target, xp }) => <li key={tier} className="rounded-lg bg-[#322747] p-1.5">
        <span className="block">Tier {tier}</span><span className="font-semibold">{target} · {xp.toLocaleString("en")} XP</span>
      </li>)}
    </ol>
  </details>;
}

export function LifetimeLeaderboard({ data }: { data: HuntAchievements }) {
  return (
    <section aria-labelledby="lifetime-leaderboard-title">
      <h2 id="lifetime-leaderboard-title" className="text-2xl font-bold">Lifetime leaderboard</h2>
      <p className="mt-1 text-sm text-[#d6c8e9]">Top 20 players by lifetime XP. Players with the same XP share a rank.</p>
      <ol className="mt-4 space-y-1.5">
        {data.leaders.map(({ username, xp, level, rank }) => (
          <li key={username} className={"flex items-center gap-3 rounded-xl px-3 py-2 text-sm " +
            (username === data.player.username ? "bg-[#493365]" : "bg-[#2a2040]")}>
            <span className="shrink-0 font-bold tabular-nums text-[#e0f887]">#{rank}</span>
            <HuntLevelBadge level={level} />
            <span className="min-w-0 flex-1 break-all font-semibold">@{username}
              {username === data.player.username && <span className="block text-xs font-normal text-[#d6c8e9]">You</span>}
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{xp.toLocaleString("en")} XP</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
