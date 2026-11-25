"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";

const items: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Home", icon: "grid" },
  { href: "/transactions", label: "Activity", icon: "arrows" },
  { href: "/products", label: "Products", icon: "cart" },
  { href: "/receipts", label: "Receipts", icon: "cart" },
];

export function MobileNavigation() {
  const pathname = usePathname();
  return <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-[#e4e9e2] bg-white/95 px-2 pb-[max(0.55rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden" aria-label="Mobile navigation">{items.map((item) => { const active = pathname === item.href; return <Link className={`inline-flex w-1/4 flex-col items-center gap-1 rounded-lg py-1 text-[10px] font-medium ${active ? "text-[#183c31]" : "text-[#7d8880]"}`} href={item.href} aria-current={active ? "page" : undefined} key={item.label}><span className={`grid size-7 place-items-center rounded-lg ${active ? "bg-[#eaf1e7]" : ""}`}><Icon name={item.icon} className="size-4" /></span>{item.label}</Link>; })}</nav>;
}
