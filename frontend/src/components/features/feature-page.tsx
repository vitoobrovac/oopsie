
"use client";

import { Toast } from "@/components/layout/toast";
import { useState, type ReactNode } from "react";

type Card = { title: string; value: string; note: string };

export function FeaturePage({ title, description, primaryAction, action, subtitle, cards, children }: {
  title: string;
  description: string;
  primaryAction?: string;
  action?: ReactNode;
  subtitle?: string;
  cards: Card[];
  children: ReactNode;
}) {
  const [notice, setNotice] = useState(false);
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {subtitle && <p className="text-xs text-[#59685e]">{subtitle}</p>}
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 max-w-xl text-sm text-[#59685e]">{description}</p>
        </div>
        {action ?? (primaryAction && <button onClick={() => setNotice(true)} className="min-h-11 rounded-xl bg-[#183c31] px-4 text-sm font-medium text-white">{primaryAction}</button>)}
      </header>
      {cards.length > 0 && <section className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Summary">
        {cards.map((card) => (
          <div key={card.title} className="rounded-2xl border border-[#e4e9e2] bg-white p-3 sm:p-5">
            <p className="text-xs text-[#59685e]">{card.title}</p>
            <p className="mt-1 text-lg font-semibold tracking-tight tabular-nums sm:text-2xl">{card.value}</p>
            <p className="mt-1 text-xs text-[#59685e]">{card.note}</p>
          </div>
        ))}
      </section>}
      {children}
      {notice && <Toast dismiss={() => setNotice(false)}>This feature is not available yet.</Toast>}
    </div>
  );
}
