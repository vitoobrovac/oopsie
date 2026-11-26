
import { BrandLogo } from "@/components/layout/brand-logo";
import { scanStages, type ScanStage } from "@/lib/receipt-scan";

export function ScanProgress({ stage }: { stage: ScanStage }) {
  const { percent, label } = scanStages[stage];
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#dce4d9] bg-[#f4f8ed] p-3">
      <div aria-hidden="true" className="relative grid size-12 shrink-0 place-items-center rounded-full bg-white">
        <span className="oopsie-orbit absolute inset-0 rounded-full border-2 border-[#dfe9d2] border-t-[#31533c]" />
        <BrandLogo compact />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p role="status" className="text-xs font-medium text-[#31533c]">{label}</p>
          <span className="text-sm font-semibold tabular-nums text-[#183c31]">{percent}%</span>
        </div>
        <progress aria-label="Receipt scan progress" value={percent} max={100}
          className="block h-2 w-full overflow-hidden rounded-full bg-[#dfe9d2] accent-[#3c7657] [&::-webkit-progress-bar]:bg-[#dfe9d2] [&::-webkit-progress-value]:bg-[#3c7657] [&::-moz-progress-bar]:bg-[#3c7657]" />
      </div>
    </div>
  );
}
