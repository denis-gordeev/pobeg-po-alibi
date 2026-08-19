const TUTU_MCP_URL = "https://mcp.tutu.ru/mcp";

type SearchOffer = {
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

type SearchPayload = {
  variants?: SearchOffer[];
  meta?: { to?: { name?: string } };
};

const escapePlans: Record<string, { destinations: string[]; label: string; excuse: string }> = {
  meeting: {
    destinations: ["Казань", "Псков", "Нижний Новгород", "Тула"],
    label: "созвона на 47 человек",
    excuse: "провести полевую верификацию акустических свойств тишины вне видеоконференций",
  },
  renovation: {
    destinations: ["Владимир", "Тверь", "Ярославль", "Калуга"],
    label: "ремонта у соседей",
    excuse: "изучить влияние отсутствия перфоратора на восстановление базовых функций организма",
  },
  adulting: {
    destinations: ["Вологда", "Кострома", "Великий Новгород", "Рязань"],
    label: "взрослой жизни",
    excuse: "пройти выездную сверку стратегических целей с внутренним ребёнком",
  },
  relatives: {
    destinations: ["Суздаль", "Коломна", "Тула", "Псков"],
    label: "вопроса «ну когда дети?»",
    excuse: "участвовать в межрегиональной конференции по защите персональных репродуктивных данных",
  },
};

function hash(input: string) {
  return [...input].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 7);
}

async function callTutu(origin: string, destination: string, date: string, budget: number) {
  const response = await fetch(TUTU_MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": "2025-06-18",
      "Mcp-Method": "tools/call",
      "Mcp-Name": "search_multitransport",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "search_multitransport",
        arguments: {
          origin,
          destination,
          departure_date: date,
          adults: 1,
          optimize_for: "price",
          price_max: budget,
          page_size: 5,
          view: "compact",
        },
      },
    }),
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`Tutu MCP: ${response.status}`);
  const rpc = (await response.json()) as {
    result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  };
  const text = rpc.result?.content?.find((item) => item.type === "text")?.text;
  if (!text || rpc.result?.isError) return null;
  return JSON.parse(text) as SearchPayload;
}

function demoOffer(origin: string, destination: string, date: string): SearchOffer {
  return {
    transport: "railway",
    price: { amount: 2405.97, currency: "RUB" },
    duration_min: 754,
    departure_at: `${date}T19:16:00+03:00`,
    arrival_at: `${date}T23:50:00+03:00`,
    carriers: ["ФПК"],
    search_results_url: "https://www.tutu.ru/poezda/",
    checkout_url: "https://www.tutu.ru/poezda/",
    legs: [{ from: origin, to: destination }],
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { origin?: string; date?: string; reason?: string; budget?: number };
    const origin = body.origin?.trim();
    const date = body.date;
    const reasonKey = body.reason || "meeting";
    const budget = Number(body.budget);
    const plan = escapePlans[reasonKey] || escapePlans.meeting;

    if (!origin || origin.length > 80) return Response.json({ error: "Укажите нормальный город отправления" }, { status: 400 });
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "Дата выглядит подозрительно" }, { status: 400 });
    if (!Number.isFinite(budget) || budget < 1000 || budget > 200000) return Response.json({ error: "Бюджет должен быть от 1 000 до 200 000 ₽" }, { status: 400 });

    const rotated = [...plan.destinations].sort((a, b) => hash(origin + date + a) - hash(origin + date + b));
    const candidates = rotated.filter((city) => city.toLocaleLowerCase("ru") !== origin.toLocaleLowerCase("ru"));
    let payload: SearchPayload | null = null;
    let destination = candidates[0];
    let source: "live" | "demo" = "live";

    for (const city of candidates.slice(0, 3)) {
      destination = city;
      try {
        payload = await callTutu(origin, city, date, budget);
      } catch {
        payload = null;
      }
      if (payload?.variants?.length) break;
    }

    let offer = payload?.variants?.[0];
    if (!offer) {
      source = "demo";
      offer = demoOffer(origin, destination, date);
    } else {
      destination = payload?.meta?.to?.name || destination;
    }

    const firstLeg = offer.legs?.[0];
    const alibi = `В связи с необходимостью ${plan.excuse} я направлен(а) в ${destination}. Выезд ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00`))}. Связь может быть нестабильной по причинам стратегического характера. Возвращение будет рассмотрено после нормализации обстановки.`;

    return Response.json({
      destination,
      reasonLabel: plan.label,
      alibi,
      protocol: `ОП-${hash(origin + date + reasonKey).toString(16).toUpperCase().slice(0, 6)}`,
      source,
      offer: {
        transport: offer.transport,
        price: offer.price,
        durationMin: offer.duration_min,
        departureAt: offer.departure_at,
        arrivalAt: offer.arrival_at,
        carrier: offer.carriers?.join(", ") || "Перевозчик не указан",
        from: firstLeg?.from || origin,
        to: firstLeg?.to || destination,
        checkoutUrl: offer.checkout_url || offer.search_results_url,
        searchResultsUrl: offer.search_results_url,
      },
    });
  } catch {
    return Response.json({ error: "Штаб временно потерял карту. Попробуйте ещё раз." }, { status: 500 });
  }
}
