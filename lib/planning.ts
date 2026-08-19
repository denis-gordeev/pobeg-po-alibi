import { destinations, type EscapeDestination } from "./destinations";

export const budgetCeilings = [7_000, 20_000, 50_000, 100_000, 250_000, 500_000, 1_000_000] as const;

export type TransportOffer = {
  transport: string;
  price: { amount: number; currency: string };
  duration_min: number;
  departure_at: string;
  arrival_at: string;
  carriers?: string[];
  search_results_url: string;
  checkout_url?: string;
  legs?: Array<{ from: string; to: string }>;
};

export type PlanCandidate = {
  place: EscapeDestination;
  offer: TransportOffer;
  distanceKm: number;
};

export function normalizeBudgetCeiling(budget: number) {
  return budgetCeilings.find((ceiling) => budget <= ceiling) ?? budgetCeilings.at(-1)!;
}

export function distanceKm(from: [number, number], to: [number, number]) {
  const radians = (value: number) => value * Math.PI / 180;
  const [lat1, lon1] = from.map(radians);
  const [lat2, lon2] = to.map(radians);
  const a = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function hash(input: string) {
  return [...input].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 7);
}

function stablePick(items: EscapeDestination[], count: number, seed: string) {
  return [...items].sort((a, b) => hash(`${seed}:${a.name}`) - hash(`${seed}:${b.name}`)).slice(0, count);
}

export function diverseDestinations(origin: [number, number], originName: string, seed: string, budget: number) {
  const rows = destinations
    .filter((place) => place.name.toLocaleLowerCase("ru") !== originName.toLocaleLowerCase("ru"))
    .map((place) => ({ place, distance: distanceKm(origin, [place.lat, place.lon]) }));
  const near = rows.filter((item) => item.distance < 550).map((item) => item.place);
  const middle = rows.filter((item) => item.distance >= 550 && item.distance < 1_500).map((item) => item.place);
  const far = rows.filter((item) => item.distance >= 1_500).map((item) => item.place);

  const allocation = budget >= 50_000 ? [2, 3, 5] : budget >= 20_000 ? [3, 4, 3] : [5, 3, 2];
  return [
    ...stablePick(near, allocation[0], `${seed}:near`),
    ...stablePick(middle, allocation[1], `${seed}:middle`),
    ...stablePick(far, allocation[2], `${seed}:far`),
  ];
}

function targetBudgetShare(budget: number) {
  if (budget < 20_000) return 0.55;
  if (budget < 50_000) return 0.62;
  if (budget < 150_000) return 0.68;
  if (budget < 500_000) return 0.55;
  return 0.42;
}

export function selectPlan(candidates: PlanCandidate[], budget: number) {
  const eligible = candidates.filter(({ offer }) => offer.price.amount > 0 && offer.price.amount <= budget);
  if (!eligible.length) return null;
  const target = targetBudgetShare(budget);
  const highBudget = budget >= 50_000;
  const meaningful = highBudget
    ? eligible.filter((candidate) => candidate.offer.price.amount / budget >= 0.12 || candidate.distanceKm >= 1_000 || /avia|plane|air/i.test(candidate.offer.transport))
    : eligible;
  if (!meaningful.length) return null;

  return [...meaningful].sort((a, b) => {
    const score = (candidate: PlanCandidate) => {
      const share = candidate.offer.price.amount / budget;
      const underuse = highBudget && share < 0.12 ? (0.12 - share) * 18 : 0;
      const distanceReward = Math.min(candidate.distanceKm / 2_500, 1.4) * (highBudget ? 1.25 : 0.45);
      const flightReward = highBudget && /avia|plane|air/i.test(candidate.offer.transport) ? 0.9 : 0;
      const commuterPenalty = highBudget && /etrain|suburban/i.test(candidate.offer.transport) ? 2.4 : 0;
      return Math.abs(share - target) * 4.5 + underuse + commuterPenalty - distanceReward - flightReward;
    };
    return score(a) - score(b);
  })[0];
}

export function selectionSummary(candidate: PlanCandidate, budget: number) {
  const budgetShare = Math.max(1, Math.round(candidate.offer.price.amount / budget * 100));
  const profile = candidate.distanceKm >= 1_500
    ? "ДАЛЬНИЙ МАНЁВР"
    : candidate.distanceKm >= 550
      ? "СМЕНА ЧАСОВОГО ПОЯСА"
      : budgetShare >= 35
        ? "КОМФОРТНЫЙ ОТРЫВ"
        : "КОРОТКАЯ ЭВАКУАЦИЯ";
  return { profile, budgetShare, distanceKm: candidate.distanceKm };
}

export class LruTtlCache<T> {
  private readonly entries = new Map<string, { expiresAt: number; value: T }>();

  constructor(private readonly limit: number, private readonly ttlMs: number) {}

  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T) {
    this.entries.delete(key);
    this.entries.set(key, { expiresAt: Date.now() + this.ttlMs, value });
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
