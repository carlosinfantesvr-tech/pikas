import { chooseModel, compressContext, estimateCostUsd, fallbackOrder, type ProviderModel, type TaskKind } from "./ai/router-core";
import { parseAnthropicSse, parseOpenAiSse, type SseDelta } from "./ai/sse";
import type { Db } from "./db";

export interface ProviderInfo {
  id: ProviderModel["provider"];
  label: string;
  configured: boolean;
  cheap: string;
  strong: string;
}

const DEFAULTS = {
  openai: { cheap: "gpt-4o-mini", strong: "gpt-4o", inCheap: 0.15, outCheap: 0.6, inStrong: 2.5, outStrong: 10 },
  anthropic: { cheap: "claude-3-5-haiku-latest", strong: "claude-sonnet-4-5", inCheap: 0.8, outCheap: 4, inStrong: 3, outStrong: 15 },
  gemini: { cheap: "gemini-2.0-flash", strong: "gemini-2.5-pro", inCheap: 0.1, outCheap: 0.4, inStrong: 1.25, outStrong: 10 },
  xai: { cheap: "grok-3-mini", strong: "grok-3", inCheap: 0.3, outCheap: 0.5, inStrong: 3, outStrong: 15 },
} as const;

function envModel(provider: keyof typeof DEFAULTS, tier: "cheap" | "strong"): string {
  const key = `${provider.toUpperCase()}_MODEL_${tier.toUpperCase()}`;
  return process.env[key] || DEFAULTS[provider][tier];
}

export function providerInfos(): ProviderInfo[] {
  return (Object.keys(DEFAULTS) as Array<keyof typeof DEFAULTS>).map((id) => ({
    id,
    label: id === "xai" ? "xAI (Grok)" : id === "openai" ? "OpenAI" : id === "anthropic" ? "Anthropic" : "Google Gemini",
    configured: Boolean(process.env[`${id === "xai" ? "XAI" : id.toUpperCase()}_API_KEY`]),
    cheap: envModel(id, "cheap"),
    strong: envModel(id, "strong"),
  }));
}

export function catalog(): ProviderModel[] {
  const infos = providerInfos();
  const models: ProviderModel[] = [];
  for (const info of infos) {
    const spec = DEFAULTS[info.id];
    models.push({ provider: info.id, tier: "cheap", model: info.cheap, configured: info.configured, estInputPerMTok: spec.inCheap, estOutputPerMTok: spec.outCheap });
    models.push({ provider: info.id, tier: "strong", model: info.strong, configured: info.configured, estInputPerMTok: spec.inStrong, estOutputPerMTok: spec.outStrong });
  }
  return models;
}

export function aiConfigured(): boolean {
  return providerInfos().some((provider) => provider.configured);
}

function parseGemini(chunk: string): SseDelta[] {
  const out: SseDelta[] = [];
  for (const line of chunk.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const json = JSON.parse(line.slice(5).trim()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
      if (text) out.push({ text });
    } catch {
      // fragmento
    }
  }
  return out;
}

export async function spend(db: Db): Promise<{ today: number; month: number; daily: number; monthly: number }> {
  const budget = await db.query<{ daily_usd: string; monthly_usd: string }>("select daily_usd, monthly_usd from ai_budget where id = 1");
  const now = Date.now();
  const day = now - 24 * 3600_000;
  const month = now - 30 * 24 * 3600_000;
  const rows = await db.query<{ estimated_cost: string | null; created_at: number }>("select estimated_cost, created_at from ai_usage where ok = 1");
  let today = 0;
  let monthSum = 0;
  for (const row of rows) {
    const cost = Number(row.estimated_cost || 0);
    if (Number(row.created_at) >= day) today += cost;
    if (Number(row.created_at) >= month) monthSum += cost;
  }
  return {
    today,
    month: monthSum,
    daily: Number(budget[0]?.daily_usd ?? process.env.AI_DAILY_BUDGET_USD ?? 1),
    monthly: Number(budget[0]?.monthly_usd ?? process.env.AI_MONTHLY_BUDGET_USD ?? 10),
  };
}

export async function routerView(db: Db) {
  const spent = await spend(db);
  const usage = await db.query("select provider, model, task, ok, cached, latency_ms, estimated_cost, created_at from ai_usage order by created_at desc limit 100");
  return {
    configured: aiConfigured(),
    providers: providerInfos(),
    pricesNote: "Los costes son estimaciones orientativas por millón de tokens, no la factura del proveedor.",
    spent,
    usage,
    choiceExample: chooseModel({ task: "market_analysis", models: catalog(), spentToday: spent.today, spentMonth: spent.month, dailyBudget: spent.daily, monthlyBudget: spent.monthly }),
  };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function streamModel(input: {
  provider: ProviderModel["provider"];
  model: string;
  messages: ChatMessage[];
  onDelta: (text: string) => void;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ content: string; promptTokens: number | null; completionTokens: number | null }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxTokens = Number(process.env.AI_MAX_OUTPUT_TOKENS || 800);
  let url = "";
  let headers: Record<string, string> = { "content-type": "application/json" };
  let body: unknown;
  const system = input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  const dialogue = input.messages.filter((message) => message.role !== "system");
  if (input.provider === "openai" || input.provider === "xai") {
    const key = input.provider === "openai" ? process.env.OPENAI_API_KEY : process.env.XAI_API_KEY;
    url = input.provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.x.ai/v1/chat/completions";
    headers = { ...headers, authorization: `Bearer ${key}` };
    body = { model: input.model, stream: true, max_tokens: maxTokens, messages: input.messages.map(({ role, content }) => ({ role, content })) };
  } else if (input.provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers = { ...headers, "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" };
    body = { model: input.model, max_tokens: maxTokens, stream: true, system, messages: dialogue.map((message) => ({ role: message.role, content: message.content })) };
  } else {
    const key = process.env.GEMINI_API_KEY || "";
    url = `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
    body = {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: dialogue.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
      generationConfig: { maxOutputTokens: maxTokens },
    };
  }
  const response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: input.signal });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`El proveedor respondió ${response.status}. ${detail.slice(0, 180)}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const splitAt = buffer.lastIndexOf("\n");
    if (splitAt < 0) continue;
    const chunk = buffer.slice(0, splitAt);
    buffer = buffer.slice(splitAt + 1);
    const deltas =
      input.provider === "anthropic" ? parseAnthropicSse(chunk) : input.provider === "gemini" ? parseGemini(chunk) : parseOpenAiSse(chunk);
    for (const delta of deltas) {
      if (delta.text) {
        content += delta.text;
        input.onDelta(delta.text);
      }
      if (delta.promptTokens) promptTokens = delta.promptTokens;
      if (delta.completionTokens) completionTokens = delta.completionTokens;
    }
  }
  if (!promptTokens) promptTokens = Math.ceil(input.messages.reduce((sum, message) => sum + message.content.length, 0) / 4);
  if (!completionTokens) completionTokens = Math.ceil(content.length / 4);
  return { content, promptTokens, completionTokens };
}

export async function runRoutedChat(input: {
  db: Db;
  userId: string;
  task: TaskKind;
  messages: ChatMessage[];
  onDelta?: (text: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; content: string; provider: string; model: string; cached: boolean; estimatedCost: number | null } | { ok: false; error: string; code: string }> {
  if (!aiConfigured()) return { ok: false, error: "PIKAS AI no configurado", code: "not_configured" };
  const spent = await spend(input.db);
  const models = catalog();
  const choice = chooseModel({
    task: input.task,
    models,
    preference: process.env.AI_PREFERRED_PROVIDER || null,
    spentToday: spent.today,
    spentMonth: spent.month,
    dailyBudget: spent.daily,
    monthlyBudget: spent.monthly,
  });
  if (!choice.ok) return { ok: false, error: choice.reason, code: choice.code === "budget" ? "budget" : "not_configured" };
  const packed = input.messages.map((message) =>
    message.role === "system" ? { ...message, content: compressContext(message.content, 12000).text } : message,
  );
  const order = fallbackOrder(models, choice);
  let lastError = "Sin proveedores.";
  for (const model of order) {
    const started = Date.now();
    try {
      let content = "";
      const result = await streamModel({
        provider: model.provider,
        model: model.model,
        messages: packed,
        fetchImpl: input.fetchImpl,
        onDelta: (text) => {
          content += text;
          input.onDelta?.(text);
        },
      });
      content = result.content || content;
      const spec = models.find((item) => item.provider === model.provider && item.model === model.model);
      const estimated = estimateCostUsd(spec, result.promptTokens || 0, result.completionTokens || 0);
      await input.db.query(
        `insert into ai_usage (id, user_id, provider, model, task, prompt_tokens, completion_tokens, estimated_cost, latency_ms, cached, ok, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,1,$10)`,
        [crypto.randomUUID(), input.userId, model.provider, model.model, input.task, result.promptTokens, result.completionTokens, estimated, Date.now() - started, Date.now()],
      );
      return { ok: true, content, provider: model.provider, model: model.model, cached: false, estimatedCost: estimated };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "error";
      await input.db.query(
        `insert into ai_usage (id, user_id, provider, model, task, latency_ms, cached, ok, error, created_at)
         values ($1,$2,$3,$4,$5,$6,0,0,$7,$8)`,
        [crypto.randomUUID(), input.userId, model.provider, model.model, input.task, Date.now() - started, lastError.slice(0, 300), Date.now()],
      );
    }
  }
  return { ok: false, error: lastError, code: "provider_error" };
}

export const PIKAS_SYSTEM = `Eres PIKAS AI, el asistente de una plataforma educativa de simulación.
No eres un asesor financiero. No hay dinero real ni órdenes reales.
Usa solo el bloque de contexto para cifras, precios, posiciones y resultados. Si un dato no está, di que no está disponible. No inventes precios ni operaciones.
Responde en español, con claridad, y recuerda la limitación cuando hables de mercado.
La confianza de otros modelos no es una probabilidad estadística.`;
