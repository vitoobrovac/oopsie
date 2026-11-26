import { formatMinor, monthLabel } from "@/lib/finance-format";
import { subscriptionCategory, yearlyExpenseCategory } from "@/lib/ledger";

const colors = ["#24594b", "#9fc66d", "#d59b6c", "#8893bc", "#c0839b", "#5b8ba0"];

export function MonthlyChart({ data, showIncome = false }: { data: { month: string; spent: number; income: number }[]; showIncome?: boolean }) {
  const maximum = Math.max(1, ...data.flatMap((row) => showIncome ? [row.spent, row.income] : [row.spent]));
  return (
    <figure className="min-w-0 rounded-2xl border border-[#e4e9e2] bg-white p-4 sm:p-6">
      <figcaption>
        <h2 className="font-semibold">{showIncome ? "Monthly cash flow" : "Monthly spending"}</h2>
        <p className="mt-1 text-xs text-[#59685e]">Current period through today</p>
      </figcaption>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#59685e]">
        <span><span aria-hidden="true" className="mr-1 text-[#507530]">●</span>Spending</span>
        {showIncome && <span><span aria-hidden="true" className="mr-1 text-[#24594b]">●</span>Income</span>}
      </div>
      <div className="mt-4 grid grid-flow-col auto-cols-fr gap-3 text-center">
        {data.map((row) => (
          <div key={row.month} className="min-w-0">
            <div aria-hidden="true" className="flex h-32 items-end justify-center gap-1 border-b border-[#e4e9e2] bg-[linear-gradient(to_top,#edf1eb_1px,transparent_1px)] bg-size-[100%_25%]">
              <div className="w-2/5 max-w-12 rounded-t-lg bg-linear-to-t from-[#698d48] to-[#b9d887]" style={{ height: row.spent / maximum * 100 + "%" }} />
              {showIncome && <div className="w-2/5 max-w-12 rounded-t-lg bg-linear-to-t from-[#183c31] to-[#4c8a75]" style={{ height: row.income / maximum * 100 + "%" }} />}
            </div>
            <p className="mt-2 text-xs font-semibold">{monthLabel(row.month, "short")}</p>
            <p className="mt-1 text-xs tabular-nums text-[#465b4e]"><span className="sr-only">Spent </span>{formatMinor(row.spent)}</p>
            {showIncome && <p className="text-xs tabular-nums text-[#465b4e]"><span className="sr-only">Income </span>{formatMinor(row.income)}</p>}
          </div>
        ))}
      </div>
    </figure>
  );
}

export function CategoryChart({ categories, period }: { categories: { label: string; amount: number }[]; period: string }) {
  const total = categories.reduce((sum, category) => sum + category.amount, 0);
  let covered = 0;
  const segments = categories.map((category, index) => ({
    ...category,
    color: category.label === yearlyExpenseCategory ? "#7c4ba1"
      : category.label === subscriptionCategory ? "#236293" : colors[index % colors.length],
  }));
  const stops = segments.map(({ amount, color }) => {
    const start = covered;
    covered += amount / total * 100;
    return color + " " + start + "% " + covered + "%";
  });

  return (
    <figure className="rounded-2xl border border-[#e4e9e2] bg-white p-4 sm:p-6">
      <figcaption className="font-semibold">Spending by category <span className="ml-1 text-xs font-normal text-[#59685e]">{period}</span></figcaption>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-5">
        <div className="grid size-32 shrink-0 place-items-center rounded-full" style={{ background: total ? "conic-gradient(" + stops.join(",") + ")" : "#edf1eb" }}>
          <span className="grid size-[77%] place-content-center rounded-full bg-white text-center text-sm font-semibold">
            <span className="text-[11px] font-normal text-[#59685e]">Total</span>{formatMinor(total)}
          </span>
        </div>
        <ul className="min-w-40 flex-1 space-y-2">
          {segments.map(({ label, amount, color }) => (
            <li key={label} className="flex items-center gap-2 text-xs">
              <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: color }} />
              <span className="flex-1">{label}</span><span className="tabular-nums">{formatMinor(amount)}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
