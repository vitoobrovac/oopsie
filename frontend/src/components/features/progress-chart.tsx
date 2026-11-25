import { formatMinor } from "@/lib/finance-format";

export function ProgressChart({ title, entries }: {
  title: string;
  entries: { label: string; amount: number; target: number }[];
}) {
  return (
    <figure className="rounded-2xl border border-[#e4e9e2] bg-white p-4 sm:p-6">
      <figcaption className="font-semibold">{title}</figcaption>
      <ul className="mt-4 space-y-4">
        {entries.map(({ label, amount, target }) => (
          <li key={label}>
            <div className="flex flex-wrap justify-between gap-x-3 text-sm">
              <span className="font-medium">{label}</span>
              <span className="text-[#59685e] tabular-nums">{formatMinor(amount)} / {formatMinor(target)}</span>
            </div>
            <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-[#edf1eb]">
              <div className={amount > target ? "h-full rounded-full bg-[#b3684e]" : "h-full rounded-full bg-linear-to-r from-[#397663] to-[#a2c978]"} style={{ width: Math.min(100, amount / target * 100) + "%" }} />
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}
