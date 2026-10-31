const API_URL = process.env.AI_API_URL || "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "qwen/qwen3.8-27b";
const UPSTREAM_TIMEOUT_MS = 25000;
const MAX_TOKENS_LIMIT = 1000;

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

const fail = (status, message, headers) => json(status, { error: { message } }, headers);

export default async (req) => {
  if (req.method !== "POST") return fail(405, "Method Not Allowed", { Allow: "POST" });

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return fail(500, "AI_API_KEY не задан на сервере");

  let payload;
  try {
    payload = await req.json();
  } catch {
    return fail(400, "Тело запроса должно быть валидным JSON");
  }

  const { messages, model, temperature, max_tokens, stream } = payload ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return fail(400, "Поле messages должно быть непустым массивом");
  }

  const body = {
    model: process.env.AI_MODEL || model || DEFAULT_MODEL,
    messages,
    ...(typeof temperature === "number" && { temperature }),
    ...(typeof max_tokens === "number" && { max_tokens: Math.min(max_tokens, MAX_TOKENS_LIMIT) }),
    ...(stream === true && { stream: true }),
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(API_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      let detail = "";
      try {
        const j = await upstream.json();
        detail = j?.error?.message || "";
      } catch {
        /* тело не JSON */
      }
      return fail(upstream.status, detail || `Ошибка внешнего API (${upstream.status})`);
    }

    // JSON и SSE пробрасываются как есть, без буферизации
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    if (e?.name === "AbortError") return fail(504, "Внешний API не ответил вовремя");
    return fail(502, "Не удалось связаться с внешним API");
  } finally {
    clearTimeout(timer);
  }
};
