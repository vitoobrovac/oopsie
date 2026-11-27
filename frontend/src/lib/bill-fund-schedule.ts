export type FundCadence = "weekly" | "monthly";
const dayMs = 86_400_000;

function monthDate(month: string, day: number, shift = 0) {
  const [year, number] = month.split("-").map(Number);
  const index = number - 1 + shift;
  const lastDay = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, index, Math.min(lastDay, day))).toISOString().slice(0, 10);
}

export function firstFundingDate(anchor: string, cadence: FundCadence, from: string) {
  if (from <= anchor) return anchor;
  if (cadence === "weekly") {
    const first = Date.parse(anchor);
    return new Date(first + Math.ceil((Date.parse(from) - first) / (7 * dayMs)) * 7 * dayMs).toISOString().slice(0, 10);
  }
  const anchorDay = Number(anchor.slice(8));
  const date = monthDate(from, anchorDay);
  return date >= from ? date : monthDate(from, anchorDay, 1);
}

export function fundingPlan(anchor: string, cadence: FundCadence, next: string, today: string, deadline: string, remaining: number) {
  if (deadline < today || next > deadline) return { count: 0, amount: 0 };
  const overdue = next < today;
  const tomorrow = new Date(Date.parse(today) + dayMs).toISOString().slice(0, 10);
  const first = overdue ? firstFundingDate(anchor, cadence, tomorrow) : next;
  let count = Number(overdue);
  if (first <= deadline) {
    if (cadence === "weekly") {
      count += 1 + Math.floor((Date.parse(deadline) - Date.parse(first)) / (7 * dayMs));
    } else {
      const [firstYear, firstMonth] = first.split("-").map(Number);
      const [lastYear, lastMonth] = deadline.split("-").map(Number);
      count += (lastYear - firstYear) * 12 + lastMonth - firstMonth
        + Number(monthDate(deadline, Number(anchor.slice(8))) <= deadline);
    }
  }
  return { count, amount: count ? Math.ceil(Math.max(0, remaining) / count) : 0 };
}
