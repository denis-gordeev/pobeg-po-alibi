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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
