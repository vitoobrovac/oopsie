import { LedgerContent } from "@/components/account/account-dialog";
import type { ReactNode } from "react";
import { MobileNavigation } from "./mobile-navigation";
import { Sidebar } from "./sidebar";

export function PageShell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#f7f8f7] text-[#17211c] lg:grid lg:grid-cols-[260px_1fr]"><Sidebar /><main className="min-w-0 px-4 pb-24 pt-5 sm:px-7 lg:px-10 lg:py-9 xl:px-14"><LedgerContent>{children}</LedgerContent></main><MobileNavigation /></div>;
}
