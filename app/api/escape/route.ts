import { cityCoordinates, destinations, type EscapeDestination } from "../../../lib/destinations";
import {
  LruTtlCache,
  distanceKm,
  diverseDestinations,
  normalizeBudgetCeiling,
  selectPlan,
  selectionSummary,
  type TransportOffer,
} from "../../../lib/planning";

const TUTU_MCP_URL = "https://mcp.tutu.ru/mcp";
const YANDEX_GPT_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function getRuntimeEnv(name: string) {
  const boundEnv = Reflect.get(globalThis, Symbol.for("pobeg.runtime.env")) as Record<string, string | undefined> | undefined;
  if (boundEnv?.[name]) return boundEnv[name];
  const runtimeProcess = Reflect.get(globalThis, "process") as { env?: Record<string, string | undefined> } | undefined;
  return runtimeProcess?.env?.[name];
}

type SearchOffer = TransportOffer;
type SearchPayload = { variants?: SearchOffer[]; meta?: { to?: { name?: string } } };
type CachedSearches = Array<{ place: EscapeDestination; payload: SearchPayload | null }>;

const routeSearchCache = new LruTtlCache<CachedSearches>(4, 15 * 60 * 1000);

const escapePlans: Record<string, { label: string; excuse: string }> = {
  meeting: { label: "созвона на 47 человек", excuse: "служебная встреча внезапно вышла за пределы часового пояса" },
  renovation: { label: "ремонта у соседей", excuse: "требуется полевая оценка акустических свойств тишины" },
  adulting: { label: "взрослой жизни", excuse: "назначена выездная сверка стратегических целей с внутренним ребёнком" },
  relatives: { label: "вопроса «ну когда дети?»", excuse: "проходит межрегиональная конференция по защите персональных репродуктивных данных" },
};

function hash(input: string) { return [...input].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 7); }

async function callTutu(origin: string, destination: string, date: string, budget: number) {
  const response = await fetch(TUTU_MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "MCP-Protocol-Version": "2025-06-18", "Mcp-Method": "tools/call", "Mcp-Name": "search_multitransport" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_multitransport", arguments: { origin, destination, departure_date: date, adults: 1, optimize_for: "price", price_max: budget, page_size: 8, view: "compact" } } }),
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`Tutu MCP: ${response.status}`);
  const rpc = (await response.json()) as { result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> } };
  const text = rpc.result?.content?.find((item) => item.type === "text")?.text;
  if (!text || rpc.result?.isError) return null;
  return JSON.parse(text) as SearchPayload;
}

function demoOffer(origin: string, destination: string, date: string, budget: number, routeDistance: number): SearchOffer {
  const amount = Math.min(budget, Math.max(1_200, Math.round(budget * (budget >= 50_000 ? 0.62 : 0.48) / 10) * 10));
  const isFlight = budget >= 50_000 && routeDistance >= 1_000;
  return { transport: isFlight ? "avia" : "railway", price: { amount, currency: "RUB" }, duration_min: isFlight ? 185 : Math.max(210, Math.round(routeDistance / 75 * 60)), departure_at: `${date}T19:16:00+03:00`, arrival_at: `${date}T23:50:00+03:00`, carriers: [isFlight ? "Учебная авиация" : "ФПК"], search_results_url: isFlight ? "https://avia.tutu.ru/" : "https://www.tutu.ru/poezda/", checkout_url: isFlight ? "https://avia.tutu.ru/" : "https://www.tutu.ru/poezda/", legs: [{ from: origin, to: destination }] };
}

function fallbackAlibis(origin: string, destination: string, date: string, plan: { excuse: string }, custom: string) {
  const when = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00`));
  const context = custom ? ` Исходная формулировка: «${custom}».` : "";
  return [
    `В связи с тем, что ${plan.excuse}, ${when} я направлен(а) из ${origin} в ${destination}. Связь может быть нестабильной по причинам стратегического характера.${context}`,
    `Прошу считать моё отсутствие согласованным: в ${destination} назначена срочная выездная проверка здравого смысла. Возвращение — после нормализации обстановки.${context}`,
    `С ${when} временно работаю в полевых условиях по маршруту ${origin} — ${destination}. Цель визита конфиденциальна, но включает восстановление способности отвечать «давайте после праздников».${context}`,
    `Уведомляю о краткосрочной географической недоступности: ведомственные обстоятельства требуют личного присутствия в городе ${destination}. Телефон останется при мне, энтузиазм — нет.${context}`,
    `По результатам внутреннего аудита принято решение немедленно сменить декорации на ${destination}. Мера временная, профилактическая и дешевле выгорания.${context}`,
  ];
}

function validateAlibis(value: unknown) {
  if (!Array.isArray(value)) return null;
  const alibis = value.filter((item): item is string => typeof item === "string" && item.trim().length > 20).slice(0, 5);
  return alibis.length === 5 ? alibis : null;
}

async function generateAlibis(input: { origin: string; destination: string; date: string; reason: string; custom: string }) {
  const relayUrl = getRuntimeEnv("LLM_RELAY_URL");
  const relayToken = getRuntimeEnv("LLM_RELAY_TOKEN");
  if (relayUrl && relayToken) {
    const response = await fetch(relayUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, relayToken }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`LLM relay: ${response.status}`);
    const data = (await response.json()) as { alibis?: unknown };
    return validateAlibis(data.alibis);
  }

  const openRouterKey = getRuntimeEnv("OPENROUTER_API_KEY");
  if (openRouterKey) {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${openRouterKey}`,
        "HTTP-Referer": "https://github.com/denis-gordeev/pobeg-po-alibi",
        "X-Title": "Pobeg Po Alibi",
      },
      body: JSON.stringify({
        model: getRuntimeEnv("OPENROUTER_MODEL") || "deepseek/deepseek-v4-flash-0731",
        temperature: 0.9,
        max_tokens: 1400,
        provider: { require_parameters: true },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "escape_alibis",
            strict: true,
            schema: { type: "object", properties: { alibis: { type: "array", minItems: 5, maxItems: 5, items: { type: "string" } } }, required: ["alibis"], additionalProperties: false },
          },
        },
        messages: [
          { role: "system", content: "Ты остроумный русский бюрократ. Пиши без криминала, подделки документов и вреда. Создай ровно 5 разных алиби, каждое 1–3 предложения. Верни только данные по заданной JSON-схеме." },
          { role: "user", content: `Маршрут: ${input.origin} — ${input.destination}, дата: ${input.date}. Причина: ${input.reason}. Черновик пользователя: ${input.custom || "не задан"}. Сохрани полезные детали черновика, но улучши стиль.` },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`OpenRouter: ${response.status}`);
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { alibis?: unknown };
    return validateAlibis(parsed.alibis);
  }

  const folderId = getRuntimeEnv("YANDEX_CLOUD_FOLDER_ID");
  const apiKey = getRuntimeEnv("YANDEX_CLOUD_API_KEY");
  const iamToken = getRuntimeEnv("YANDEX_CLOUD_IAM_TOKEN");
  if (!folderId || (!apiKey && !iamToken)) return null;
  const response = await fetch(YANDEX_GPT_URL, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: apiKey ? `Api-Key ${apiKey}` : `Bearer ${iamToken}` },
    body: JSON.stringify({
      modelUri: `gpt://${folderId}/yandexgpt/latest`,
      completionOptions: { stream: false, temperature: 0.85, maxTokens: 1200 },
      messages: [
        { role: "system", text: "Ты остроумный русский бюрократ. Пиши без криминала, подделки документов и вреда. Ответь только JSON-объектом вида {\"alibis\":[\"...\"]}. Ровно 5 разных алиби, каждое 1–3 предложения." },
        { role: "user", text: `Сделай пять абсурдных, но правдоподобных оправданий для поездки ${input.origin} — ${input.destination} на ${input.date}. Причина: ${input.reason}. Черновик пользователя: ${input.custom || "не задан"}. Сохрани полезные детали черновика, но улучши стиль.` },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`YandexGPT: ${response.status}`);
  const data = (await response.json()) as { result?: { alternatives?: Array<{ message?: { text?: string } }> } };
  const raw = data.result?.alternatives?.[0]?.message?.text?.trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { alibis?: unknown };
  return validateAlibis(parsed.alibis);
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
    const body = (await request.json()) as { origin?: string; date?: string; reason?: string; budget?: number; customAlibi?: string };
    const origin = body.origin?.trim();
    const date = body.date;
    const reasonKey = body.reason || "meeting";
    const budget = Number(body.budget);
    const customAlibi = body.customAlibi?.trim() || "";
    const plan = escapePlans[reasonKey] || escapePlans.meeting;
    if (!origin || origin.length > 80) return Response.json({ error: "Укажите нормальный город отправления" }, { status: 400 });
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "Дата выглядит подозрительно" }, { status: 400 });
    if (!Number.isFinite(budget) || budget < 1000 || budget > 1_000_000) return Response.json({ error: "Бюджет должен быть от 1 000 до 1 000 000 ₽" }, { status: 400 });
    if (customAlibi.length > 600) return Response.json({ error: "Черновик алиби должен быть короче 600 символов" }, { status: 400 });

    const [originLat, originLon] = await geocode(origin);
    const originPoint: [number, number] = [originLat, originLon];
    const ceiling = normalizeBudgetCeiling(budget);
    const candidates = diverseDestinations(originPoint, origin, `${origin}:${date}:${reasonKey}`, budget);
    const cacheKey = `${origin.toLocaleLowerCase("ru")}:${date}:${reasonKey}:${ceiling}`;
    let searches = routeSearchCache.get(cacheKey);
    const cacheStatus = searches ? "hit" : "miss";
    if (!searches) {
      searches = await Promise.all(candidates.map(async (place) => {
        try { return { place, payload: await callTutu(origin, place.name, date, ceiling) }; }
        catch { return { place, payload: null }; }
      }));
      routeSearchCache.set(cacheKey, searches);
    }
    const ranked = searches.flatMap(({ place, payload }) => (payload?.variants || []).map((offer) => ({
      place,
      payload,
      offer,
      distanceKm: distanceKm(originPoint, [place.lat, place.lon]),
    })));
    const found = selectPlan(ranked, budget);

    let place: EscapeDestination = found?.place || (budget >= 50_000 ? candidates.at(-1)! : candidates[0]);
    let offer = found?.offer;
    let routeDistance = found?.distanceKm || distanceKm(originPoint, [place.lat, place.lon]);
    let source: "live" | "demo" = "live";
    if (!offer) { source = "demo"; offer = demoOffer(origin, place.name, date, budget, routeDistance); }
    else {
      const payload = ranked.find((candidate) => candidate.offer === offer)?.payload;
      place = destinations.find((item) => item.name === payload?.meta?.to?.name) || place;
      routeDistance = distanceKm(originPoint, [place.lat, place.lon]);
    }
    const selection = selectionSummary({ place, offer, distanceKm: routeDistance }, budget);

    let alibis: string[] | null = null;
    try { alibis = await generateAlibis({ origin, destination: place.name, date, reason: plan.label, custom: customAlibi }); }
    catch (error) {
      console.error("LLM generation failed:", error instanceof Error ? error.message : "unknown error");
      alibis = null;
    }
    const llmSource = alibis ? (getRuntimeEnv("LLM_RELAY_URL") || getRuntimeEnv("OPENROUTER_API_KEY") ? "openrouter" : "yandexgpt") : "fallback";
    alibis ||= fallbackAlibis(origin, place.name, date, plan, customAlibi);
    const firstLeg = offer.legs?.[0];

    return Response.json({
      destination: place.name, reasonLabel: plan.label, alibis, llmSource,
      protocol: `ОП-${hash(origin + date + reasonKey).toString(16).toUpperCase().slice(0, 6)}`,
      source, place, selection, cache: { status: cacheStatus, ceiling },
      route: { from: { name: origin, lat: originLat, lon: originLon }, to: { name: place.name, lat: place.lat, lon: place.lon } },
      offer: { transport: offer.transport, price: offer.price, durationMin: offer.duration_min, departureAt: offer.departure_at, arrivalAt: offer.arrival_at, carrier: offer.carriers?.join(", ") || "Перевозчик не указан", from: firstLeg?.from || origin, to: firstLeg?.to || place.name, checkoutUrl: offer.checkout_url || offer.search_results_url, searchResultsUrl: offer.search_results_url },
    });
  } catch {
    return Response.json({ error: "Штаб временно потерял карту. Попробуйте ещё раз." }, { status: 500 });
  }
}
