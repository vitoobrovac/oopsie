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

export function useHunt<T>(path: "hunt/profile" | "hunt/lobby") {
  const { session } = useAccount();
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    void accountRequest<T>(session, path, { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) setState({ data }); },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : "Could not load Oopsie Hunt." });
      },
    );
    return () => controller.abort();
  }, [session, path, attempt]);

  return {
    ...state,
    setData: (data: T) => setState({ data }),
    retry: () => { setState({}); setAttempt((value) => value + 1); },
  };
}
