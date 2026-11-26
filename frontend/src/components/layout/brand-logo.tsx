import Image from "next/image";
import logo from "@/app/icon.png";

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <Image src={logo} alt="" unoptimized preload={!compact}
      className={compact ? "size-10 shrink-0 object-contain" : "size-[84px] object-contain lg:size-28"} />
  );
}
