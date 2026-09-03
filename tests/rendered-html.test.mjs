import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("server-renders the finished escape planner", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    env,
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ru">/);
  assert.match(html, /<title>Побег по алиби/);
  assert.match(html, /НЕ ТУРИЗМ\. ТАКТИЧЕСКОЕ ОТСУТСТВИЕ/);
  assert.match(html, /СФОРМИРОВАТЬ ПОБЕГ/);
  assert.match(html, /ВАШ ЧЕРНОВИК АЛИБИ/);
  assert.match(html, /КАК И СКОЛЬКО БЕЖИМ/);
  assert.match(html, /БЕЗ ОГРАНИЧЕНИЙ/);
  assert.match(html, /Последние операции/);
  assert.match(html, /Четыре последних маршрута останутся только в этом браузере/);
  assert.match(html, /1М/);
  assert.match(html, /пять алиби/i);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("escape endpoint limits the custom alibi draft", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/escape", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin: "Москва", date: "2026-09-01", budget: 7000, customAlibi: "я".repeat(601) }),
    }),
    env,
    context,
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /600/);
});

test("escape endpoint rejects malformed requests", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/escape", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin: "", date: "tomorrow", budget: 3 }),
    }),
    env,
    context,
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /город/i);
});

test("escape endpoint validates transport and duration filters", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/escape", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin: "Москва", date: "2026-09-10", budget: 7000, transportModes: [], maxDurationMin: 30 }),
    }),
    env,
    context,
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /транспорт/i);
});

test("high budgets prefer a meaningful trip over a 700-ruble commuter train", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes("mcp.tutu.ru")) return originalFetch(input, init);
    const request = JSON.parse(String(init?.body));
    const destination = request.params.arguments.destination;
    const cheap = destination === "Рязань";
    const offer = {
      transport: cheap ? "etrain" : "avia",
      price: { amount: cheap ? 700 : 32_000, currency: "RUB" },
      duration_min: cheap ? 180 : 210,
      departure_at: "2026-09-03T09:00:00+03:00",
      arrival_at: "2026-09-03T12:30:00+03:00",
      carriers: [cheap ? "ЦППК" : "Тестовые авиалинии"],
      search_results_url: "https://www.tutu.ru/",
      checkout_url: "https://www.tutu.ru/",
      legs: [{ from: "Москва", to: destination }],
    };
    return Response.json({ result: { content: [{ type: "text", text: JSON.stringify({ variants: [offer] }) }] } });
  };

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/escape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origin: "Москва", date: "2026-09-03", reason: "meeting", budget: 50_000 }),
      }),
      env,
      context,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.offer.transport, "avia");
    assert.equal(body.offer.price.amount, 32_000);
    assert.equal(body.selection.budgetShare, 64);
    assert.equal(body.cache.ceiling, 50_000);
    assert.deepEqual(body.alternatives.map(({ id }) => id), ["economy", "balanced", "far", "budget"]);
    assert.equal(body.alternatives.length, 4);
    assert.equal(new Set(body.alternatives.map(({ destination }) => destination)).size, 4);
    assert.ok(body.alternatives.every(({ offer, route, selection }) => offer.checkoutUrl && route.to.name && selection.distanceKm > 0));
    assert.ok(body.alternatives.every(({ offer }) => offer.quote.source === "tutu" && !Number.isNaN(Date.parse(offer.quote.fetchedAt))));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("escape endpoint applies transport and duration filters to live offers", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes("mcp.tutu.ru")) return originalFetch(input, init);
    const request = JSON.parse(String(init?.body));
    const destination = request.params.arguments.destination;
    const variants = [
      { transport: "railway", price: { amount: 1800, currency: "RUB" }, duration_min: 600 },
      { transport: "avia", price: { amount: 6200, currency: "RUB" }, duration_min: 170 },
    ].map((offer) => ({
      ...offer,
      departure_at: "2026-09-11T09:00:00+03:00",
      arrival_at: "2026-09-11T12:00:00+03:00",
      carriers: ["Тестовый перевозчик"],
      search_results_url: "https://www.tutu.ru/",
      checkout_url: "https://www.tutu.ru/",
      legs: [{ from: "Москва", to: destination }],
    }));
    return Response.json({ result: { content: [{ type: "text", text: JSON.stringify({ variants }) }] } });
  };

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/escape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origin: "Москва", date: "2026-09-11", reason: "meeting", budget: 20_000, transportModes: ["avia"], maxDurationMin: 180 }),
      }),
      env,
      context,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, "live");
    assert.equal(body.offer.transport, "avia");
    assert.ok(body.alternatives.every(({ offer }) => offer.transport === "avia" && offer.durationMin <= 180));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("alibi refresh changes destination without calling Tutu", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls += 1;
    throw new Error("No external request is expected for fallback alibis");
  };

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/alibis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origin: "Москва", destination: "Псков", date: "2026-09-05", reason: "renovation", customAlibi: "Проверяю тишину" }),
      }),
      env,
      context,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.llmSource, "fallback");
    assert.equal(body.reasonLabel, "ремонта у соседей");
    assert.equal(body.alibis.length, 5);
    assert.ok(body.alibis.some((alibi) => alibi.includes("Псков")));
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
