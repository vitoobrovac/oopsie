
"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useAccount } from "@/components/account/account-provider";
import { saveMotionPreference, useReducedMotionPreference } from "@/lib/motion-preference";
import { HuntProfileSetting } from "./hunt-profile-setting";
import { AccountReset } from "./account-reset";
import { useLedger } from "@/lib/use-ledger";
import type { OverviewPeriod } from "@/lib/ledger";

const field = "mt-2 min-h-11 w-full rounded-xl border border-[#dfe5dc] bg-white px-3 py-2 text-base";
const saveButton = "mt-3 min-h-11 rounded-xl bg-[#183c31] px-4 text-sm font-semibold text-white disabled:opacity-50";
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type SaveStatus = { text: string; error?: boolean };

export function SettingsPage() {
  const { session } = useAccount();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-[#59685e]">Manage your profile, reporting period, and appearance.</p>
      </header>
      <ProfileSetting key={session?.user.id} />
      <HuntProfileSetting />
      <OverviewPeriodSetting key={session?.user.id} />
      <MonthStartSetting />
      <WeekStartSetting key={session?.user.id} />
      <MotionSetting />
      <AccountReset key={session?.user.id} />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e4e9e2] bg-white">
      <h2 className="border-b border-[#edf0ec] px-4 py-3 text-sm font-semibold sm:px-5">{title}</h2>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function Status({ message }: { message: SaveStatus | null }) {
  if (!message) return null;
  return <p role={message.error ? "alert" : "status"} className={"mt-2 text-xs " + (message.error ? "text-red-800" : "text-[#31533c]")}>{message.text}</p>;
}

function ProfileSetting() {
  const { session, displayName, changeDisplayName } = useAccount();
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<SaveStatus | null>(null);
  const name = draft ?? displayName;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      await changeDisplayName(name);
      setDraft(null);
      setMessage({ text: "Profile saved." });
    } catch {
      setMessage({ text: "Could not save your profile. Try again.", error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <Group title="Profile">
      <form onSubmit={save}>
        {session?.user.email && <p className="mb-3 break-words text-xs text-[#59685e]">Signed in as {session.user.email}</p>}
        <label className="block text-sm font-medium">
          Display name
          <input className={field} name="displayName" value={name} maxLength={60} autoComplete="nickname" disabled={pending}
            onChange={(event) => { setDraft(event.target.value); setMessage(null); }} />
        </label>
        <p className="mt-1 text-xs text-[#59685e]">Appears on your Overview and in the Account menu.</p>
        <button className={saveButton} disabled={pending || name.trim() === displayName}>{pending ? "Saving…" : "Save profile"}</button>
        <Status message={message} />
      </form>
    </Group>
  );
}

function MonthStartSetting() {
  const { monthStartDay, report, saveMonthStartDay, canWrite } = useLedger();
  const [draft, setDraft] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<SaveStatus | null>(null);
  const day = draft ?? monthStartDay;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      await saveMonthStartDay(day);
      setDraft(null);
      setMessage({ text: "Reporting period saved." });
    } catch {
      setMessage({ text: "Could not save the reporting period. Try again.", error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <Group title="Reporting period">
      <form onSubmit={save}>
        <label className="block text-sm font-medium">Month starts on
          <select className={field} disabled={!canWrite || pending} value={day}
            onChange={(event) => { setDraft(Number(event.target.value)); setMessage(null); }}>
            {Array.from({ length: 31 }, (_, index) => index + 1).map((option) => (
              <option value={option} key={option}>{option === 1 ? "Day 1 (calendar month)" : "Day " + option}</option>
            ))}
          </select>
        </label>
        <p className="mt-1 text-xs text-[#59685e]">Choose your payday or any other day for budgets and monthly reports.</p>
        <p className="mt-2 text-xs font-medium text-[#31533c]">Current period · {report.range}</p>
        <button className={saveButton} disabled={!canWrite || pending || day === monthStartDay}>{pending ? "Saving…" : "Save reporting period"}</button>
        <Status message={message} />
      </form>
    </Group>
  );
}

function OverviewPeriodSetting() {
  const { overviewPeriod, changeOverviewPeriod } = useAccount();
  const [draft, setDraft] = useState<OverviewPeriod | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<SaveStatus | null>(null);
  const period = draft ?? overviewPeriod;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || period === overviewPeriod) return;
    setPending(true);
    setMessage(null);
    try {
      await changeOverviewPeriod(period);
      setDraft(null);
      setMessage({ text: "Overview default saved." });
    } catch {
      setMessage({ text: "Could not save your Overview default. Try again.", error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <Group title="Overview">
      <form onSubmit={save}>
        <label className="block text-sm font-medium">Default period
          <select className={field} disabled={pending} value={period}
            onChange={(event) => { setDraft(event.target.value as OverviewPeriod); setMessage(null); }}>
            <option value="month">Month</option>
            <option value="week">Week</option>
          </select>
        </label>
        <p className="mt-1 text-xs text-[#59685e]">Sets which summary and chart open when you visit Overview.</p>
        <button className={saveButton} disabled={pending || period === overviewPeriod}>{pending ? "Saving…" : "Save Overview default"}</button>
        <Status message={message} />
      </form>
    </Group>
  );
}

function WeekStartSetting() {
  const { weekStartDay, changeWeekStartDay } = useAccount();
  const [draft, setDraft] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<SaveStatus | null>(null);
  const day = draft ?? weekStartDay;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || day === weekStartDay) return;
    setPending(true);
    setMessage(null);
    try {
      await changeWeekStartDay(day);
      setDraft(null);
      setMessage({ text: "First day of the week saved." });
    } catch {
      setMessage({ text: "Could not save the first day of the week. Try again.", error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <Group title="Weekly reporting">
      <form onSubmit={save}>
        <label className="block text-sm font-medium">First day of the week
          <select className={field} disabled={pending} value={day}
            onChange={(event) => { setDraft(Number(event.target.value)); setMessage(null); }}>
            {weekdays.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
          </select>
        </label>
        <p className="mt-1 text-xs text-[#59685e]">Sets where the Overview’s weekly spending and income chart begins.</p>
        <button className={saveButton} disabled={pending || day === weekStartDay}>{pending ? "Saving…" : "Save week start"}</button>
        <Status message={message} />
      </form>
    </Group>
  );
}

function MotionSetting() {
  const reduced = useReducedMotionPreference();
  const [message, setMessage] = useState<SaveStatus | null>(null);
  return (
    <Group title="Appearance">
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
        <span>
          <span className="block text-sm font-medium">Reduce motion</span>
          <span className="mt-1 block text-xs text-[#59685e]">Turns off opening and loading animations on this browser.</span>
        </span>
        <input type="checkbox" checked={reduced} className="size-5 shrink-0 accent-[#183c31]" onChange={(event) => {
          try {
            saveMotionPreference(event.target.checked);
            setMessage({ text: "Saved on this browser." });
          } catch {
            setMessage({ text: "This browser could not save the preference.", error: true });
          }
        }} />
      </label>
      <Status message={message} />
    </Group>
  );
}
