import { subscriptionCategory, yearlyExpenseCategory, type ManualEntry } from "./ledger";

export type Plan = "budgets" | "goals" | "subscriptions";
export type Priority = "low" | "normal" | "high";
export const priorityWeight = { low: 1, normal: 2, high: 3 } satisfies Record<Priority, number>;
export type Budget = { id: string; category: string; amount_minor: number; priority?: Priority };
export type Goal = { id: string; name: string; amount_minor: number; saved_minor: number; priority?: Priority };
export type Cadence = "weekly" | "monthly" | "yearly" | "yearly_split";
export type Subscription = { id: string; name: string; amount_minor: number; starts_on: string; next_due: string; cadence: Cadence; active: boolean };
export type PlanItem = Budget | Goal | Subscription;

type LocalPlanning = {
  budgets: Budget[];
  goals: Goal[];
  subscriptions: Subscription[];
  postings: Record<string, ManualEntry | null>;
};

export const useLocalPlanning = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_PLANNING_STORAGE === "preview";
const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });
const dayMs = 86_400_000;

function nextDue(anchor: string, cadence: Subscription["cadence"], from: string) {
  if (from <= anchor) return anchor;
  const first = Date.parse(anchor);
  const after = Date.parse(from);
  if (cadence === "weekly") return new Date(first + Math.ceil((after - first) / (7 * dayMs)) * 7 * dayMs).toISOString().slice(0, 10);
  const originalDay = Number(anchor.slice(8));
  const [year, month] = from.split("-").map(Number);
  const due = (index: number) => new Date(Date.UTC(year, index, Math.min(originalDay, new Date(Date.UTC(year, index + 1, 0)).getUTCDate())));
  const index = cadence === "yearly" ? Number(anchor.slice(5, 7)) - 1 : month - 1;
  const step = cadence === "yearly" ? 12 : 1;
  const current = due(index);
  return (current.getTime() >= after ? current : due(index + step)).toISOString().slice(0, 10);
}

export function isYearlyCadence(cadence: Cadence) {
  return cadence === "yearly" || cadence === "yearly_split";
}

export function scheduledPayment(subscription: Subscription) {
  if (subscription.cadence !== "yearly_split") return subscription.amount_minor;
  const [dueYear, dueMonth] = subscription.next_due.split("-").map(Number);
  const [firstYear, firstMonth] = subscription.starts_on.split("-").map(Number);
  const installment = ((dueYear - firstYear) * 12 + dueMonth - firstMonth) % 12;
  return Math.floor(subscription.amount_minor / 12) + Number(installment < subscription.amount_minor % 12);
}

export function localPlanningKey(owner: string) {
  return "oopsie:local-planning:" + owner;
}

function update<T>(owner: string, now: Date, change: (data: LocalPlanning, today: string) => T) {
  const key = localPlanningKey(owner);
  const stored = window.localStorage.getItem(key);
  const data: LocalPlanning = stored ? JSON.parse(stored) : { budgets: [], goals: [], subscriptions: [], postings: {} };
  const before = JSON.stringify(data);
  const today = dateFormat.format(now);
  postDue(data, today);
  const result = change(data, today);
  const after = JSON.stringify(data);
  if (after !== before) window.localStorage.setItem(key, after);
  return result;
}

function postDue(data: LocalPlanning, today: string) {
  for (const subscription of data.subscriptions) {
    if (!subscription.active) continue;
    while (subscription.next_due <= today) {
      const date = subscription.next_due;
      const id = "local-subscription:" + subscription.id + ":" + date;
      if (!(id in data.postings)) {
        data.postings[id] = { id, date, name: subscription.name, category: isYearlyCadence(subscription.cadence) ? yearlyExpenseCategory : subscriptionCategory, merchant: "", amountMinor: -scheduledPayment(subscription) };
      }
      const tomorrow = new Date(Date.parse(date) + dayMs).toISOString().slice(0, 10);
      subscription.next_due = nextDue(subscription.starts_on, subscription.cadence, tomorrow);
    }
  }
}

export function localSubscriptionEntries(owner: string, now = new Date()) {
  return update(owner, now, (data) => Object.values(data.postings).filter((entry): entry is ManualEntry => entry !== null));
}

export function deleteLocalSubscriptionEntry(owner: string, id: string) {
  update(owner, new Date(), (data) => {
    if (id in data.postings) data.postings[id] = null;
  });
}

export function listLocalPlans(owner: string, plan: Plan) {
  return update(owner, new Date(), (data) => data[plan]);
}

export function saveLocalPlan(owner: string, plan: Plan, payload: object, entryId?: string) {
  return update(owner, new Date(), (data, today) => {
    const id = entryId ?? crypto.randomUUID();
    const items: PlanItem[] = data[plan];
    const index = items.findIndex((item) => item.id === id);
    if (entryId && index === -1) throw new Error("This record no longer exists.");
    let saved = { ...payload, id } as PlanItem;
    if ("category" in saved) {
      const category = saved.category.trim().toLowerCase();
      if (data.budgets.some((item) => item.id !== id && item.category.trim().toLowerCase() === category)) {
        throw new Error("A budget already exists for this category.");
      }
    }
    if ("starts_on" in saved) {
      const previous = data.subscriptions.find((item) => item.id === id);
      const reset = !previous || previous.starts_on !== saved.starts_on || previous.cadence !== saved.cadence || (saved.active && !previous.active);
      saved = { ...saved, next_due: reset ? nextDue(saved.starts_on, saved.cadence, today) : previous.next_due };
    }
    if (index < 0) items.push(saved);
    else items[index] = saved;
    postDue(data, today);
    return saved;
  });
}

export function deleteLocalPlan(owner: string, plan: Plan, id: string) {
  update(owner, new Date(), (data) => {
    const items: PlanItem[] = data[plan];
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) items.splice(index, 1);
  });
}
