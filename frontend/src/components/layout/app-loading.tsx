"use client";

import { useEffect, useState } from "react";
import { BrandLogo } from "./brand-logo";

export function AppLoading({ label, opening = false, waitingLabel }: { label: string; opening?: boolean; waitingLabel?: string }) {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!waitingLabel) return;
    const timeout = window.setTimeout(() => setWaiting(true), 3500);
    return () => window.clearTimeout(timeout);
  }, [waitingLabel]);

  return (
    <div role="status" aria-busy="true" className={opening
      ? "grid min-h-dvh place-items-center bg-[#f1f5ed] px-5"
      : "mx-auto grid min-h-[min(50dvh,24rem)] max-w-4xl place-items-center rounded-3xl border border-[#e0e9dd] bg-[#f1f5ed] p-4"}>
      <div className="flex flex-col items-center text-center">
        <div aria-hidden="true" className="relative grid size-32 place-items-center rounded-full bg-[#e4eedc]">
          <span className="oopsie-orbit absolute inset-0 rounded-full border-2 border-[#d4e3cc] border-t-[#30694c] border-r-[#82a563]" />
          <div className="oopsie-float"><BrandLogo /></div>
        </div>
        {opening && <p aria-hidden="true" className="mt-4 text-2xl font-bold tracking-tight text-[#183c31]">oopsie</p>}
        <p className="mt-3 text-sm font-medium text-[#31533c]">{label}</p>
        {waiting && waitingLabel && <p className="mt-1 max-w-xs text-xs text-[#59685e]">{waitingLabel}</p>}
      </div>
    </div>
  );
}
