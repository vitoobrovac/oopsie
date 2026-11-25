"use client";

import Link from "next/link";
import { Toast } from "@/components/layout/toast";
import { useState } from "react";
import { useLedger } from "@/lib/use-ledger";

export function SettingsPage() {
  const [language, setLanguage] = useState("English");
  const [currency, setCurrency] = useState("EUR");
  const [notice, setNotice] = useState<string | null>(null);
  return <div className="mx-auto max-w-3xl"><header><p className="text-sm text-[#718078]">Personalize your space</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">Settings</h1><p className="mt-2 text-sm leading-6 text-[#718078]">Set your reporting month. Profile, language and currency controls are previews.</p></header><section className="mt-7 space-y-4"><MonthStartSetting /><Group title="Profile"><Row title="Display name" description="Used only to personalize your dashboard"><input className="mt-2 w-full rounded-xl border border-[#dfe5dc] px-3 py-2 text-sm outline-none" placeholder="Your name" /></Row><Row title="Language" description="Controls the app interface language"><select value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-2 w-full rounded-xl border border-[#dfe5dc] bg-white px-3 py-2 text-sm outline-none"><option>English</option><option>Hrvatski</option><option>Deutsch</option></select></Row></Group><Group title="Money"><Row title="Default currency" description="Preview selection. Transactions are recorded in EUR."><select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-2 w-full rounded-xl border border-[#dfe5dc] bg-white px-3 py-2 text-sm outline-none"><option value="EUR">EUR — Euro</option><option value="USD">USD — US Dollar</option><option value="GBP">GBP — Pound Sterling</option></select></Row><Row title="Start of week" description="Used by future calendar and reporting screens"><select className="mt-2 w-full rounded-xl border border-[#dfe5dc] bg-white px-3 py-2 text-sm outline-none"><option>Monday</option><option>Sunday</option></select></Row></Group><Group title="Future connections"><Row title="Receipt scanning" description="Upload photos and review extracted purchases"><Link href="/receipts/new" className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-[#dfe5dc] px-3 text-sm font-medium text-[#31533c]">Scan a receipt</Link></Row><Row title="oopsie AI" description="Ask questions about your spending"><button onClick={() => setNotice("oopsie AI is planned, but not available yet.")} className="mt-2 rounded-lg border border-[#dfe5dc] px-3 py-2 text-sm font-medium text-[#627067]">Coming later</button></Row></Group></section>{notice && <Toast dismiss={() => setNotice(null)}>{notice}</Toast>}</div>;
}
function Group({ title, children }: { title: string; children: React.ReactNode }) { return <section className="overflow-hidden rounded-2xl border border-[#e4e9e2] bg-white"><h2 className="border-b border-[#edf0ec] px-5 py-4 text-sm font-semibold">{title}</h2>{children}</section>; }
function Row({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <div className="border-b border-[#edf0ec] px-5 py-4 last:border-b-0"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-[#7b867f]">{description}</p>{children}</div>; }

function MonthStartSetting() {
  const { monthStartDay, report, saveMonthStartDay, canWrite } = useLedger();
  const [message, setMessage] = useState("");

  const [pending, setPending] = useState(false);
  async function changeDay(day: number) {
    setPending(true);
    try {
      await saveMonthStartDay(day);
      setMessage("Saved to your account.");
    } catch {
      setMessage("Could not save the setting. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Group title="Reporting period">
      <Row title="Month starts on" description="Choose your payday or any other day. In shorter months, the period starts on the last day if your chosen day is unavailable.">
        <select aria-label="Month starts on" disabled={!canWrite || pending} value={monthStartDay} onChange={(event) => changeDay(Number(event.target.value))}
          className="mt-2 min-h-11 w-full rounded-xl border border-[#dfe5dc] bg-white px-3 py-2 text-base">
          {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
            <option value={day} key={day}>{day === 1 ? "Day 1 (calendar month)" : "Day " + day}</option>
          ))}
        </select>
        <p className="mt-2 text-xs text-[#59685e]">Current period · {report.range}</p>
        {message && <p role="status" className="mt-2 text-xs text-[#31533c]">{message}</p>}
      </Row>
    </Group>
  );
}
