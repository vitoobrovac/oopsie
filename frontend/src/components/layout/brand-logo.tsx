import Image from "next/image";
import logo from "@/app/icon.png";

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <span className="relative block size-10 shrink-0 overflow-hidden rounded-xl bg-white">
        <Image src={logo} alt="" sizes="60px"
          className="absolute -left-[22%] -top-[8%] h-auto w-[144%] max-w-none" />
      </span>
    );
  }

  return (
    <Image src={logo} alt="oopsie" sizes="(min-width: 1024px) 112px, 84px" preload
      className="h-auto w-[84px] rounded-2xl border border-black/5 bg-white lg:w-28" />
  );
}
