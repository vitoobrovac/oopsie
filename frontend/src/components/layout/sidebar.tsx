"use client";

import { AccountButton } from "@/components/account/account-dialog";
import { navigation } from "@/lib/mock-data";
import { dismissModal, Modal } from "./modal";
import { BrandLogo } from "./brand-logo";
import { Icon, type IconName } from "./icon";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";

export function Sidebar() {
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const [menuOpen, setMenuOpen] = useState(false);
  return <aside className="border-b border-[#e6e9e4] bg-[#fcfdfb] px-4 py-4 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-5 lg:py-7">
    <div className="flex items-center justify-between"><Link className="flex items-center gap-2.5 font-semibold tracking-[-0.04em]" href="/"><BrandLogo compact /><span className="text-xl">oopsie</span></Link><div className="flex items-center gap-1"><AccountButton /><button onClick={() => setMenuOpen(true)} className="grid size-9 place-items-center rounded-xl text-[#526058] hover:bg-[#edf1eb]" aria-label="Open more pages"><Icon name="grid" className="size-5" /></button></div></div>
    <nav className="mt-5 hidden space-y-1 lg:block" aria-label="Main navigation"><p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[#98a19b]">Everyday</p>{navigation.slice(0, 3).map((item) => <NavItem key={item.label} label={item.label} icon={item.icon} active={pathname === (item.label === "Overview" ? "/" : `/${item.label.toLowerCase()}`)} />)}</nav>
    {menuOpen && <MoreMenu onClose={() => setMenuOpen(false)} />}
  </aside>;
}

function NavItem({ label, icon, active = false }: { label: string; icon: IconName; active?: boolean }) { const href = label === "Overview" ? "/" : `/${label.toLowerCase()}`; return <Link href={href} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${active ? "bg-[#edf2e8] text-[#183c31]" : "text-[#667169] hover:bg-[#f2f4f1]"}`}><Icon name={icon} className="size-[17px]" />{label}</Link>; }



const morePages: { href: string; label: string; description: string; icon: IconName }[] = [
  { href: "/receipts", label: "Receipts", description: "Browse every saved receipt", icon: "cart" },
  { href: "/budgets", label: "Budgets", description: "Plan category spending", icon: "pie" },
  { href: "/goals", label: "Goals", description: "Track what you’re saving for", icon: "target" },
  { href: "/products", label: "Products", description: "Search what you bought", icon: "search" },
  { href: "/subscriptions", label: "Subscriptions", description: "Track recurring expenses", icon: "refresh" },
  { href: "/challenges", label: "Challenges", description: "Save together · Preview", icon: "target" },
  { href: "/settings", label: "Settings", description: "Language, currency and profile", icon: "settings" },
];

function MoreMenu({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  return (
    <Modal titleId={titleId} onClose={onClose} placement="menu">
      <div className="flex items-center justify-between gap-2">
            <h2 id={titleId} className="text-sm font-semibold">More from oopsie</h2>
            <button onClick={dismissModal} className="min-h-11 rounded-lg px-2 text-sm text-[#59685e]">Close</button>
      </div>
      <nav className="mt-2 grid gap-2 sm:grid-cols-2" aria-label="More pages">
            {morePages.map((page) => (
              <Link onClick={dismissModal} href={page.href} key={page.href} className="flex items-center gap-3 rounded-xl border border-[#e5e9e3] p-3 hover:bg-[#f6f8f4]">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#edf3e8] text-[#31533c]"><Icon name={page.icon} className="size-4" /></span>
                <span><span className="block text-sm font-medium">{page.label}</span><span className="block text-xs text-[#59685e]">{page.description}</span></span>
              </Link>
            ))}
      </nav>
    </Modal>
  );
}
