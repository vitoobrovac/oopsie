
"use client";

import { useEffect, type ReactNode } from "react";
import { AppLoading } from "@/components/layout/app-loading";
import { useReducedMotionPreference } from "@/lib/motion-preference";
import { useAccount } from "./account-provider";
import { SignInScreen } from "./sign-in-screen";

export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, session } = useAccount();
  const reducedMotion = useReducedMotionPreference();
  useEffect(() => {
    document.documentElement.toggleAttribute("data-oopsie-reduced-motion", reducedMotion);
    return () => document.documentElement.removeAttribute("data-oopsie-reduced-motion");
  }, [reducedMotion]);

  if (!ready) return <AppLoading opening label="Checking your session…" />;
  return session
    ? <div key={session.user.id} className="oopsie-reveal min-h-dvh">{children}</div>
    : <div className="oopsie-reveal"><SignInScreen /></div>;
}
