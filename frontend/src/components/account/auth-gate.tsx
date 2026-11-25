"use client";

import type { ReactNode } from "react";
import { useAccount } from "./account-provider";
import { SignInScreen } from "./sign-in-screen";

export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, session } = useAccount();
  if (!ready) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#f3f6ef]" aria-busy="true">
        <p role="status" className="text-sm text-[#31533c]">Checking your session…</p>
      </main>
    );
  }
  return session ? <div key={session.user.id} className="min-h-dvh">{children}</div> : <SignInScreen />;
}
