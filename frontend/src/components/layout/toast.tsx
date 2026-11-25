"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Toast({ children, dismiss }: { children: ReactNode; dismiss: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function dismissOutside(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !container.current?.contains(target)) dismiss();
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [dismiss]);

  return (
    <div ref={container} role="status" className="fixed inset-x-4 bottom-24 z-30 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-[#183c31] px-4 py-2 text-sm text-white shadow-lg lg:bottom-6">
      <span>{children}</span>
      <button onClick={dismiss} className="min-h-11 shrink-0 px-1 font-medium text-[#d8ee79]">Dismiss</button>
    </div>
  );
}
