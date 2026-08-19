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
