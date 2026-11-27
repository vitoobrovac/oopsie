import { priorityWeight, type Goal } from "./local-planning";

export type GoalAllocation = { goal_id: string; allocated_on: string; amount_minor: number };
export type SavingsPeriod = "week" | "month" | "year";

export function amountsByGoal(allocations: GoalAllocation[]) {
  const totals = new Map<string, number>();
  for (const allocation of allocations) {
    totals.set(allocation.goal_id, (totals.get(allocation.goal_id) ?? 0) + allocation.amount_minor);
  }
  return totals;
}

export function availableGoals(goals: Goal[], allocations: GoalAllocation[]) {
  const saved = amountsByGoal(allocations);
  return goals.map((goal) => ({
    ...goal, remaining: Math.max(0, goal.amount_minor - goal.saved_minor - (saved.get(goal.id) ?? 0)),
    weight: priorityWeight[goal.priority ?? "normal"],
  })).filter((goal) => goal.remaining > 0).sort(
    (a, b) => b.weight - a.weight || b.remaining - a.remaining || a.id.localeCompare(b.id),
  );
}

export function suggestSplit(goals: ReturnType<typeof availableGoals>, amount: number) {
  const parts = goals.slice(0, 100).map((goal) => ({ goal, amount_minor: 0 }));
  let left = Math.min(amount, parts.reduce((sum, { goal }) => sum + goal.remaining, 0));
  while (left > 0) {
    const available = parts.filter(({ goal, amount_minor }) => amount_minor < goal.remaining);
    const weight = available.reduce((sum, { goal, amount_minor }) => sum + BigInt(goal.remaining - amount_minor) * BigInt(goal.weight), BigInt(0));
    const pool = BigInt(left);
    const fractions = available.map((part) => {
      const room = part.goal.remaining - part.amount_minor;
      const share = pool * BigInt(room) * BigInt(part.goal.weight);
      const cents = Math.min(room, Number(share / weight));
      part.amount_minor += cents;
      left -= cents;
      return { part, remainder: share % weight };
    });
    fractions.sort((a, b) => a.remainder === b.remainder ? 0 : a.remainder > b.remainder ? -1 : 1);
    for (const { part } of fractions) {
      if (!left) break;
      if (part.amount_minor < part.goal.remaining) {
        part.amount_minor += 1;
        left -= 1;
      }
    }
  }
  return parts.filter(({ amount_minor }) => amount_minor > 0);
}
