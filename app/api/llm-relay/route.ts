const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function getRuntimeEnv(name: string) {
  const boundEnv = Reflect.get(globalThis, Symbol.for("pobeg.runtime.env")) as Record<string, string | undefined> | undefined;
  if (boundEnv?.[name]) return boundEnv[name];
  const runtimeProcess = Reflect.get(globalThis, "process") as { env?: Record<string, string | undefined> } | undefined;
  return runtimeProcess?.env?.[name];
}

export async function POST(request: Request) {
  const relayToken = getRuntimeEnv("LLM_RELAY_TOKEN");
  const openRouterKey = getRuntimeEnv("OPENROUTER_API_KEY");
  if (!relayToken || request.headers.get("authorization") !== `Bearer ${relayToken}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!openRouterKey) return Response.json({ error: "relay not configured" }, { status: 503 });

  const input = (await request.json()) as { origin?: string; destination?: string; date?: string; reason?: string; custom?: string };
  if (!input.origin || !input.destination || !input.date || !input.reason || (input.custom?.length || 0) > 600) return Response.json({ error: "invalid input" }, { status: 400 });

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${openRouterKey}`, "HTTP-Referer": "https://pobeg-po-alibi.boris-chan.chatgpt.site", "X-Title": "Pobeg Po Alibi" },
    body: JSON.stringify({
      model: getRuntimeEnv("OPENROUTER_MODEL") || "deepseek/deepseek-v4-flash-0731",
      temperature: 0.9,
      max_tokens: 1400,
      provider: { require_parameters: true },
      response_format: { type: "json_schema", json_schema: { name: "escape_alibis", strict: true, schema: { type: "object", properties: { alibis: { type: "array", minItems: 5, maxItems: 5, items: { type: "string" } } }, required: ["alibis"], additionalProperties: false } } },
      messages: [
        { role: "system", content: "Ты остроумный русский бюрократ. Пиши без криминала, подделки документов и вреда. Создай ровно 5 разных алиби, каждое 1–3 предложения. Верни только данные по заданной JSON-схеме." },
        { role: "user", content: `Маршрут: ${input.origin} — ${input.destination}, дата: ${input.date}. Причина: ${input.reason}. Черновик пользователя: ${input.custom || "не задан"}. Сохрани полезные детали черновика, но улучши стиль.` },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return Response.json({ error: `upstream ${response.status}` }, { status: 502 });
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return Response.json({ error: "empty upstream" }, { status: 502 });
  const parsed = JSON.parse(content) as { alibis?: unknown };
  if (!Array.isArray(parsed.alibis) || parsed.alibis.length !== 5) return Response.json({ error: "invalid upstream" }, { status: 502 });
  return Response.json({ alibis: parsed.alibis });
}
