"use client";

import { useEffect, useState } from "react";
import { accountRequest, useAccount } from "@/components/account/account-provider";

export type HuntProfile = { player_id: string; username: string | null };
export type HuntLobby = {
  profile: HuntProfile;
  week: { type: "cheapest" | "sniper" | "bingo" | "twins"; starts_on: string; ends_on: string; title: string; description: string; objectives: { label: string; detail: string }[] } | null;
  player_count: number;
  players: string[];
};

export type HuntRank = { username: string; xp: number; level: number; rank: number };
export type HuntAchievement = {
  id: string; name: string; description: string; icon: string; progress: number;
  tiers: { tier: number; target: number; xp: number; claimed: boolean }[];
};
export type UpcomingHuntAchievement = Omit<HuntAchievement, "progress" | "tiers"> & {
  tiers: Omit<HuntAchievement["tiers"][number], "claimed">[];
};
export type HuntAchievements = {
  player: HuntRank; leaders: HuntRank[]; challenges: HuntAchievement[];
  upcoming?: UpcomingHuntAchievement[]; joined_week?: string | null; awarded_xp?: number;
};

export function useHunt<T>(path: "hunt/profile" | "hunt/lobby" | "hunt/achievements" | "hunt/rewards", enabled = true, revision = 0) {
  const { session } = useAccount();
  const [state, setState] = useState<{ owner?: string; data?: T; error?: string }>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!session || !enabled) return;
    const controller = new AbortController();
    void accountRequest<T>(session, path, { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) setState({ owner: session.user.id, data }); },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ owner: session.user.id, error: error instanceof Error ? error.message : "Could not load Oopsie Hunt." });
      },
    );
    return () => controller.abort();
  }, [session, path, attempt, enabled, revision]);

  return {
    ...(state.owner === session?.user.id ? state : {}),
    setData: (data: T) => setState({ owner: session?.user.id, data }),
    retry: () => { setState({}); setAttempt((value) => value + 1); },
  };
}
