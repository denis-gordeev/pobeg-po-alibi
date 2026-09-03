const YANDEX_GPT_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type AlibiSource = "openrouter" | "yandexgpt" | "fallback";

export const escapePlans: Record<string, { label: string; excuse: string }> = {
  meeting: { label: "созвона на 47 человек", excuse: "служебная встреча внезапно вышла за пределы часового пояса" },
  renovation: { label: "ремонта у соседей", excuse: "требуется полевая оценка акустических свойств тишины" },
  adulting: { label: "взрослой жизни", excuse: "назначена выездная сверка стратегических целей с внутренним ребёнком" },
  relatives: { label: "вопроса «ну когда дети?»", excuse: "проходит межрегиональная конференция по защите персональных репродуктивных данных" },
};

function getRuntimeEnv(name: string) {
  const boundEnv = Reflect.get(globalThis, Symbol.for("pobeg.runtime.env")) as Record<string, string | undefined> | undefined;
  if (boundEnv?.[name]) return boundEnv[name];
  const runtimeProcess = Reflect.get(globalThis, "process") as { env?: Record<string, string | undefined> } | undefined;
  return runtimeProcess?.env?.[name];
}

export function fallbackAlibis(origin: string, destination: string, date: string, plan: { excuse: string }, custom: string) {
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
    return { alibis: validateAlibis(data.alibis), source: "openrouter" as const };
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
    if (!raw) return { alibis: null, source: "openrouter" as const };
    const parsed = JSON.parse(raw) as { alibis?: unknown };
    return { alibis: validateAlibis(parsed.alibis), source: "openrouter" as const };
  }

  const folderId = getRuntimeEnv("YANDEX_CLOUD_FOLDER_ID");
  const apiKey = getRuntimeEnv("YANDEX_CLOUD_API_KEY");
  const iamToken = getRuntimeEnv("YANDEX_CLOUD_IAM_TOKEN");
  if (!folderId || (!apiKey && !iamToken)) return { alibis: null, source: "fallback" as const };
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
  if (!raw) return { alibis: null, source: "yandexgpt" as const };
  const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { alibis?: unknown };
  return { alibis: validateAlibis(parsed.alibis), source: "yandexgpt" as const };
}

export async function createAlibiPackage(input: { origin: string; destination: string; date: string; reasonKey: string; custom: string }) {
  const plan = escapePlans[input.reasonKey] || escapePlans.meeting;
  try {
    const generated = await generateAlibis({ ...input, reason: plan.label });
    if (generated.alibis) return { alibis: generated.alibis, llmSource: generated.source, reasonLabel: plan.label };
  } catch (error) {
    console.error("LLM generation failed:", error instanceof Error ? error.message : "unknown error");
  }
  return { alibis: fallbackAlibis(input.origin, input.destination, input.date, plan, input.custom), llmSource: "fallback" as const, reasonLabel: plan.label };
}
