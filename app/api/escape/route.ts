import { cityCoordinates, destinations, type EscapeDestination } from "../../../lib/destinations";
import { createAlibiPackage } from "../../../lib/alibis";
import {
  LruTtlCache,
  distanceKm,
  diverseDestinations,
  normalizeBudgetCeiling,
  offerMatchesFilters,
  selectPlan,
  selectPlanProfiles,
  selectionSummary,
  transportModes,
  type TransportMode,
  type TransportOffer,
} from "../../../lib/planning";

const TUTU_MCP_URL = "https://mcp.tutu.ru/mcp";

type SearchOffer = TransportOffer;
type SearchPayload = { variants?: SearchOffer[]; meta?: { to?: { name?: string } } };
type CachedSearches = {
  fetchedAt: string;
  rows: Array<{ place: EscapeDestination; payload: SearchPayload | null }>;
};
type RankedCandidate = ReturnType<typeof rankedCandidate>;

const routeSearchCache = new LruTtlCache<CachedSearches>(4, 15 * 60 * 1000);

function rankedCandidate(place: EscapeDestination, offer: SearchOffer, originPoint: [number, number]) {
  return { place, offer, distanceKm: distanceKm(originPoint, [place.lat, place.lon]) };
}

function publicRoute(candidate: RankedCandidate, origin: string, originPoint: [number, number], budget: number, quote: { source: "tutu" | "demo"; fetchedAt: string }) {
  const { place, offer } = candidate;
  const firstLeg = offer.legs?.[0];
  return {
    destination: place.name,
    place,
    selection: selectionSummary(candidate, budget),
    route: { from: { name: origin, lat: originPoint[0], lon: originPoint[1] }, to: { name: place.name, lat: place.lat, lon: place.lon } },
    offer: { transport: offer.transport, price: offer.price, durationMin: offer.duration_min, departureAt: offer.departure_at, arrivalAt: offer.arrival_at, carrier: offer.carriers?.join(", ") || "Перевозчик не указан", from: firstLeg?.from || origin, to: firstLeg?.to || place.name, checkoutUrl: offer.checkout_url || offer.search_results_url, searchResultsUrl: offer.search_results_url, quote },
  };
}

function hash(input: string) { return [...input].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 7); }

async function callTutu(origin: string, destination: string, date: string, budget: number) {
  const response = await fetch(TUTU_MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "MCP-Protocol-Version": "2025-06-18", "Mcp-Method": "tools/call", "Mcp-Name": "search_multitransport" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_multitransport", arguments: { origin, destination, departure_date: date, adults: 1, optimize_for: budget >= 50_000 ? "duration" : "price", price_max: budget, page_size: 8, view: "compact" } } }),
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`Tutu MCP: ${response.status}`);
  const rpc = (await response.json()) as { result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> } };
  const text = rpc.result?.content?.find((item) => item.type === "text")?.text;
  if (!text || rpc.result?.isError) return null;
  return JSON.parse(text) as SearchPayload;
}

function demoOffer(origin: string, destination: string, date: string, budget: number, routeDistance: number, modes: TransportMode[]): SearchOffer {
  const distanceShare = 0.25 + Math.min(routeDistance / 2_500, 1) * 0.5;
  const amount = Math.min(budget, Math.max(1_200, Math.round(budget * distanceShare / 10) * 10));
  const preferredMode: TransportMode = modes.includes("avia") && budget >= 50_000 && routeDistance >= 1_000
    ? "avia"
    : modes.includes("railway") ? "railway" : modes[0];
  const durationMin = preferredMode === "avia"
    ? Math.max(100, Math.round(70 + routeDistance / 700 * 60))
    : preferredMode === "bus"
      ? Math.max(75, Math.round(routeDistance / 65 * 60))
      : Math.max(90, Math.round(routeDistance / 85 * 60));
  const provider = preferredMode === "avia" ? ["Учебная авиация", "https://avia.tutu.ru/"] : preferredMode === "bus" ? ["Учебный автобус", "https://bus.tutu.ru/"] : ["ФПК", "https://www.tutu.ru/poezda/"];
  return { transport: preferredMode, price: { amount, currency: "RUB" }, duration_min: durationMin, departure_at: `${date}T19:16:00+03:00`, arrival_at: `${date}T23:50:00+03:00`, carriers: [provider[0]], search_results_url: provider[1], checkout_url: provider[1], legs: [{ from: origin, to: destination }] };
}

async function geocode(city: string): Promise<[number, number]> {
  const known = cityCoordinates[city.toLocaleLowerCase("ru")];
  if (known) return known;
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", city); url.searchParams.set("format", "jsonv2"); url.searchParams.set("limit", "1");
    const response = await fetch(url, { headers: { "User-Agent": "PobegPoAlibi/2.0 (github.com/denis-gordeev/pobeg-po-alibi)" }, signal: AbortSignal.timeout(6000) });
    const rows = (await response.json()) as Array<{ lat: string; lon: string }>;
    if (rows[0]) return [Number(rows[0].lat), Number(rows[0].lon)];
  } catch { /* map falls back to Moscow */ }
  return [55.7558, 37.6176];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { origin?: string; date?: string; reason?: string; budget?: number; customAlibi?: string; transportModes?: unknown; maxDurationMin?: unknown };
    const origin = body.origin?.trim();
    const date = body.date;
    const reasonKey = body.reason || "meeting";
    const budget = Number(body.budget);
    const customAlibi = body.customAlibi?.trim() || "";
    const requestedModes = body.transportModes === undefined ? transportModes : body.transportModes;
    const maxDurationMin = body.maxDurationMin === undefined || body.maxDurationMin === null ? null : Number(body.maxDurationMin);
    if (!origin || origin.length > 80) return Response.json({ error: "Укажите нормальный город отправления" }, { status: 400 });
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "Дата выглядит подозрительно" }, { status: 400 });
    if (!Number.isFinite(budget) || budget < 1000 || budget > 1_000_000) return Response.json({ error: "Бюджет должен быть от 1 000 до 1 000 000 ₽" }, { status: 400 });
    if (customAlibi.length > 600) return Response.json({ error: "Черновик алиби должен быть короче 600 символов" }, { status: 400 });
    if (!Array.isArray(requestedModes) || requestedModes.length === 0 || requestedModes.some((mode) => !transportModes.includes(mode as TransportMode))) return Response.json({ error: "Выберите хотя бы один доступный вид транспорта" }, { status: 400 });
    if (maxDurationMin !== null && (!Number.isInteger(maxDurationMin) || maxDurationMin < 60 || maxDurationMin > 72 * 60)) return Response.json({ error: "Максимальное время в пути должно быть от 1 до 72 часов" }, { status: 400 });
    const selectedModes = [...new Set(requestedModes)] as TransportMode[];

    const [originLat, originLon] = await geocode(origin);
    const originPoint: [number, number] = [originLat, originLon];
    const ceiling = normalizeBudgetCeiling(budget);
    const candidates = diverseDestinations(originPoint, origin, `${origin}:${date}:${reasonKey}`, budget);
    const cacheKey = `${origin.toLocaleLowerCase("ru")}:${date}:${reasonKey}:${ceiling}`;
    let cachedSearches = routeSearchCache.get(cacheKey);
    const cacheStatus = cachedSearches ? "hit" : "miss";
    if (!cachedSearches) {
      const rows = await Promise.all(candidates.map(async (place) => {
        try { return { place, payload: await callTutu(origin, place.name, date, ceiling) }; }
        catch { return { place, payload: null }; }
      }));
      cachedSearches = { fetchedAt: new Date().toISOString(), rows };
      routeSearchCache.set(cacheKey, cachedSearches);
    }
    const ranked = cachedSearches.rows.flatMap(({ place, payload }) => (payload?.variants || []).filter((offer) => offerMatchesFilters(offer, selectedModes, maxDurationMin)).map((offer) => ({
      ...rankedCandidate(place, offer, originPoint), payload,
    })));
    const found = selectPlan(ranked, budget);
    const demoCandidates = destinations
      .filter((candidatePlace) => candidatePlace.name.toLocaleLowerCase("ru") !== origin.toLocaleLowerCase("ru"))
      .map((candidatePlace) => {
        const candidateDistance = distanceKm(originPoint, [candidatePlace.lat, candidatePlace.lon]);
        return rankedCandidate(candidatePlace, demoOffer(origin, candidatePlace.name, date, budget, candidateDistance, selectedModes), originPoint);
      })
      .filter(({ offer: candidateOffer }) => offerMatchesFilters(candidateOffer, selectedModes, maxDurationMin));
    const fallback = selectPlan(demoCandidates, budget);
    const chosen = found || fallback;
    if (!chosen) return Response.json({ error: "По заданным фильтрам не нашлось маршрутов. Увеличьте время в пути или выберите другой транспорт." }, { status: 422 });

    let place: EscapeDestination = chosen.place;
    const offer = chosen.offer;
    let routeDistance = chosen.distanceKm;
    const source: "live" | "demo" = found ? "live" : "demo";
    if (found) {
      const payload = ranked.find((candidate) => candidate.offer === offer)?.payload;
      place = destinations.find((item) => item.name === payload?.meta?.to?.name) || place;
      routeDistance = distanceKm(originPoint, [place.lat, place.lon]);
    }
    const selection = selectionSummary({ place, offer, distanceKm: routeDistance }, budget);
    const liveProfileCandidates = selectPlanProfiles(ranked, budget);
    const demoProfileCandidates = selectPlanProfiles(demoCandidates, budget);
    const profileCandidates = liveProfileCandidates.length === 4 ? liveProfileCandidates : demoProfileCandidates;
    const liveQuote = { source: "tutu" as const, fetchedAt: cachedSearches.fetchedAt };
    const demoQuote = { source: "demo" as const, fetchedAt: cachedSearches.fetchedAt };
    const alternatives = profileCandidates.map(({ id, label, candidate }) => {
      const isLive = ranked.some((item) => item.offer === candidate.offer);
      return { id, label, ...publicRoute(candidate, origin, originPoint, budget, isLive ? liveQuote : demoQuote) };
    });

    const alibiPackage = await createAlibiPackage({ origin, destination: place.name, date, reasonKey, custom: customAlibi });
    const selectedRoute = publicRoute({ place, offer, distanceKm: routeDistance }, origin, originPoint, budget, source === "live" ? liveQuote : demoQuote);

    return Response.json({
      destination: place.name, ...alibiPackage,
      protocol: `ОП-${hash(origin + date + reasonKey).toString(16).toUpperCase().slice(0, 6)}`,
      source, ...selectedRoute, selection, alternatives, cache: { status: cacheStatus, ceiling },
    });
  } catch {
    return Response.json({ error: "Штаб временно потерял карту. Попробуйте ещё раз." }, { status: 500 });
  }
}
