"use client";

import { useState, type FormEvent } from "react";
import { BrandLogo } from "@/components/layout/brand-logo";
import { supabase } from "./account-provider";

const field = "min-h-12 w-full rounded-xl border border-[#dce4d9] bg-white px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-[#50795d]";

export function SignInScreen() {
  const [signup, setSignup] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function run(operation: () => Promise<void>) {
    setPending(true);
    setMessage(null);
    try { await operation(); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : "Sign-in failed. Try again.", error: true }); }
    finally { setPending(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const auth = supabase?.auth;
    if (!auth || pending) return;
    const fields = new FormData(event.currentTarget);
    const credentials = { email: String(fields.get("email")).trim(), password: String(fields.get("password")) };
    void run(async () => {
      if (signup) {
        const { data, error } = await auth.signUp({ ...credentials, options: { emailRedirectTo: window.location.origin + "/" } });
        if (error) throw error;
        if (!data.session) setMessage({ text: "Check your email for a confirmation link to finish signing up." });
      } else {
        const { error } = await auth.signInWithPassword(credentials);
        if (error) throw error;
      }
    });
  }

  function google() {
    const auth = supabase?.auth;
    if (!auth || pending) return;
    void run(async () => {
      const { error } = await auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/" } });
      if (error) throw error;
    });
  }

  return (
    <main className="min-h-dvh bg-[#f3f6ef] p-3 sm:p-6 [font-family:var(--font-geist-sans),Arial,sans-serif]">
      <div className="mx-auto grid min-h-[calc(100dvh-1.5rem)] max-w-6xl overflow-hidden rounded-[1.75rem] border border-[#e4e9e2] bg-[#fdfefa] sm:min-h-[calc(100dvh-3rem)] lg:grid-cols-[1fr_1fr]">
        <aside className="relative hidden min-h-full flex-col justify-between overflow-hidden bg-[#183c31] p-12 text-white lg:flex xl:p-14">
          <BrandLogo />
          <div className="relative z-10 my-12">
            <p className="max-w-sm text-5xl font-semibold leading-[1.06] tracking-[-.06em] xl:text-6xl">See where your money goes.</p>
            <p className="mt-5 max-w-xs text-sm leading-6 text-[#d3e1d9]">Track what comes in, what goes out, and what you have left until payday.</p>
          </div>
          <div aria-hidden="true" className="relative mt-6 flex h-48 items-end gap-3 border-b border-white/30">
            {[30, 48, 40, 68, 58, 84, 100].map((height, index) => (
              <span key={height} className={"flex-1 rounded-t-full " + (index === 6 ? "bg-[#d9ef7f]" : "bg-white/15")} style={{ height: height + "%" }} />
            ))}
          </div>
        </aside>

        <div className="flex items-center justify-center px-5 py-8 sm:px-12 sm:py-12">
          <div className="w-full max-w-sm">
            <div className="mb-8 lg:hidden"><BrandLogo /></div>
            <h1 className="text-[2rem] font-semibold leading-tight tracking-[-.05em] sm:text-[2.65rem]">
              {signup ? "Create your account" : "Welcome back"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-[#59685e]">
              {signup ? "Start tracking your spending and income." : "Sign in to see your spending and income."}
            </p>

            <button type="button" onClick={google} disabled={!supabase || pending}
              className="mt-7 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#dce4d9] bg-white px-4 text-sm font-semibold hover:bg-[#edf3e9] disabled:opacity-50">
              <span aria-hidden="true" className="text-base font-bold text-[#3564bf]">G</span>
              Continue with Google
            </button>
            <div className="my-5 flex items-center gap-3 text-xs text-[#59685e]">
              <span className="h-px flex-1 bg-[#dce4d9]" />or use email<span className="h-px flex-1 bg-[#dce4d9]" />
            </div>

            <form onSubmit={submit} className="grid gap-4">
              <label className="grid gap-1.5 text-sm font-medium">Email
                <input required name="email" type="email" autoComplete="email" className={field} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">Password
                <input required name="password" type="password" minLength={signup ? 8 : undefined}
                  autoComplete={signup ? "new-password" : "current-password"} className={field} />
              </label>
              <button disabled={!supabase || pending}
                className="min-h-12 rounded-xl bg-[#183c31] px-4 text-sm font-semibold text-white hover:bg-[#24594b] disabled:opacity-50">
                {pending ? "Please wait…" : signup ? "Create account" : "Sign in"}
              </button>
            </form>
            <p className="mt-5 text-center text-sm text-[#59685e]">
              {signup ? "Already have an account?" : "New to oopsie?"}{" "}
              <button type="button" disabled={pending} className="min-h-11 font-semibold text-[#183c31] underline underline-offset-4"
                onClick={() => { setSignup(!signup); setMessage(null); }}>
                {signup ? "Sign in" : "Create an account"}
              </button>
            </p>
            {!supabase && <p role="status" className="mt-3 text-sm text-[#59685e]">Sign-in is unavailable until Supabase is configured.</p>}
            {message && <p role={message.error ? "alert" : "status"} className={"mt-3 rounded-xl px-3 py-2 text-sm " + (message.error ? "bg-red-50 text-red-800" : "bg-[#eaf1e7] text-[#31533c]")}>{message.text}</p>}
          </div>
        </div>
      </div>
    </main>
  );
}
