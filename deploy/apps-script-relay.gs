function doPost(e) {
  try {
    const properties = PropertiesService.getScriptProperties();
    const openRouterKey = properties.getProperty("OPENROUTER_API_KEY");
    const expectedToken = properties.getProperty("RELAY_TOKEN");
    const input = JSON.parse((e.postData && e.postData.contents) || "{}");

    if (!openRouterKey || !expectedToken || input.relayToken !== expectedToken) {
      return jsonResponse({ error: "unauthorized" });
    }
    if (!input.origin || !input.destination || !input.date || !input.reason) {
      return jsonResponse({ error: "invalid input" });
    }

    const upstream = UrlFetchApp.fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "post",
      contentType: "application/json",
      headers: {
        Authorization: "Bearer " + openRouterKey,
        "HTTP-Referer": "https://github.com/denis-gordeev/pobeg-po-alibi",
        "X-Title": "Pobeg Po Alibi"
      },
      payload: JSON.stringify({
        model: properties.getProperty("OPENROUTER_MODEL") || "deepseek/deepseek-v4-flash-0731",
        temperature: 0.9,
        max_tokens: 1400,
        provider: { require_parameters: true },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "escape_alibis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                alibis: {
                  type: "array",
                  minItems: 5,
                  maxItems: 5,
                  items: { type: "string" }
                }
              },
              required: ["alibis"],
              additionalProperties: false
            }
          }
        },
        messages: [
          {
            role: "system",
            content: "Ты остроумный русский бюрократ. Пиши без криминала, подделки документов и вреда. Создай ровно 5 разных алиби, каждое 1–3 предложения. Верни только данные по заданной JSON-схеме."
          },
          {
            role: "user",
            content: "Маршрут: " + input.origin + " — " + input.destination +
              ", дата: " + input.date + ". Причина: " + input.reason +
              ". Черновик пользователя: " + (input.custom || "не задан") +
              ". Сохрани полезные детали черновика, но улучши стиль."
          }
        ]
      }),
      muteHttpExceptions: true
    });

    const status = upstream.getResponseCode();
    const data = JSON.parse(upstream.getContentText());
    if (status < 200 || status >= 300) {
      return jsonResponse({ error: "upstream " + status });
    }

    const raw = data.choices && data.choices[0] && data.choices[0].message &&
      data.choices[0].message.content;
    if (!raw) return jsonResponse({ error: "empty upstream response" });

    const parsed = JSON.parse(raw);
    const alibis = Array.isArray(parsed.alibis)
      ? parsed.alibis.filter(function (item) {
          return typeof item === "string" && item.trim().length > 20;
        }).slice(0, 5)
      : [];

    if (alibis.length !== 5) return jsonResponse({ error: "invalid upstream response" });
    return jsonResponse({ alibis: alibis });
  } catch (error) {
    return jsonResponse({ error: "relay failed", detail: String(error).slice(0, 180) });
  }
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
