import { BrandLogo } from "@/components/layout/brand-logo";

export function ScanProgress() {
  return (
    <div role="status" className="flex flex-col items-center gap-3 rounded-2xl border border-[#dce4d9] bg-[#f4f8ed] px-4 py-5 text-center">
      <div aria-hidden="true" className="relative grid size-[74px] place-items-center rounded-full bg-white">
        <span className="absolute inset-0 rounded-full border-[3px] border-[#dfe9d2] border-r-[#84a962] border-t-[#31533c] motion-safe:animate-spin" />
        <BrandLogo compact />
      </div>
      <p className="text-sm font-semibold text-[#31533c]">Reading your receipt…</p>
      <p className="text-xs text-[#59685e]">Oopsie is finding the items and prices. This can take a moment.</p>
    </div>
  );
}
