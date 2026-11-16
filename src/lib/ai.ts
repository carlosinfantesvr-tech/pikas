import { classifyProviderFailure, cooldownMs, compressContext, estimateCostUsd, planChain, type ProviderModel, type TaskKind } from "./ai/router-core";
import { parseAnthropicSse, parseOpenAiSse, type SseDelta } from "./ai/sse";
import { PIKAS_PERSONA, splitMemory, streamChunks } from "./ai/voice";
import type { Db } from "./db";

export interface ProviderInfo {
  id: string;
  label: string;
  configured: boolean;
  cheap: string;
  strong: string;
  free: boolean;
  priority: number;
}

interface ProviderSpec {
  id: string;
  label: string;
  priority: number;
  free: boolean;
  cheap: string;
  strong: string;
  inCheap: number;
  outCheap: number;
  inStrong: number;
  outStrong: number;
  configured: () => boolean;
}

function envOr(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

const PROVIDERS: ProviderSpec[] = [
  { id: "ollama", label: "Ollama local", priority: 10, free: true, cheap: "llama3.2", strong: "llama3.2", inCheap: 0, outCheap: 0, inStrong: 0, outStrong: 0, configured: () => Boolean(process.env.OLLAMA_BASE_URL) },
  { id: "gemini", label: "Google Gemini", priority: 20, free: true, cheap: "gemini-3.6-flash", strong: "gemini-3.8-flash", inCheap: 0, outCheap: 0, inStrong: 0, outStrong: 0, configured: () => Boolean(process.env.GEMINI_API_KEY) },
  { id: "groq", label: "Groq", priority: 30, free: true, cheap: "openai/gpt-oss-20b", strong: "openai/gpt-oss-120b", inCheap: 0, outCheap: 0, inStrong: 0, outStrong: 0, configured: () => Boolean(process.env.GROQ_API_KEY) },
  { id: "openrouter", label: "OpenRouter", priority: 40, free: true, cheap: "openrouter/free", strong: "openrouter/free", inCheap: 0, outCheap: 0, inStrong: 0, outStrong: 0, configured: () => Boolean(process.env.OPENROUTER_API_KEY) },
  { id: "cloudflare", label: "Cloudflare Workers AI", priority: 50, free: true, cheap: "@cf/meta/llama-3.1-8b-instruct", strong: "@cf/meta/llama-3.1-8b-instruct", inCheap: 0, outCheap: 0, inStrong: 0, outStrong: 0, configured: () => Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) },
  { id: "huggingface", label: "Hugging Face", priority: 60, free: true, cheap: "Qwen/Qwen2.5-7B-Instruct", strong: "Qwen/Qwen2.5-7B-Instruct", inCheap: 0, outCheap: 0, inStrong: 0, outStrong: 0, configured: () => Boolean(process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY) },
  { id: "mistral", label: "Mistral", priority: 70, free: true, cheap: "mistral-small-latest", strong: "mistral-small-latest", inCheap: 0, outCheap: 0, inStrong: 0, outStrong: 0, configured: () => Boolean(process.env.MISTRAL_API_KEY) },
  { id: "cerebras", label: "Cerebras", priority: 80, free: false, cheap: "gpt-oss-120b", strong: "gpt-oss-120b", inCheap: 0, outCheap: 0, inStrong: 0, outStrong: 0, configured: () => Boolean(process.env.CEREBRAS_API_KEY) },
  { id: "openai", label: "OpenAI", priority: 200, free: false, cheap: "gpt-4o-mini", strong: "gpt-4o", inCheap: 0.15, outCheap: 0.6, inStrong: 2.5, outStrong: 10, configured: () => Boolean(process.env.OPENAI_API_KEY) && process.env.AI_ALLOW_PAID === "true" },
  { id: "anthropic", label: "Anthropic", priority: 210, free: false, cheap: "claude-3-5-haiku-latest", strong: "claude-sonnet-4-5", inCheap: 0.8, outCheap: 4, inStrong: 3, outStrong: 15, configured: () => Boolean(process.env.ANTHROPIC_API_KEY) && process.env.AI_ALLOW_PAID === "true" },
  { id: "xai", label: "xAI", priority: 220, free: false, cheap: "grok-3-mini", strong: "grok-3", inCheap: 0.3, outCheap: 0.5, inStrong: 3, outStrong: 15, configured: () => Boolean(process.env.XAI_API_KEY) && process.env.AI_ALLOW_PAID === "true" },
];

function modelName(spec: ProviderSpec, tier: "cheap" | "strong"): string {
  const envName = `${spec.id.toUpperCase()}_MODEL_${tier.toUpperCase()}`;
  return envOr(envName, tier === "cheap" ? spec.cheap : spec.strong);
}

export function providerInfos(): ProviderInfo[] {
  return PROVIDERS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    configured: spec.configured(),
    cheap: modelName(spec, "cheap"),
    strong: modelName(spec, "strong"),
    free: spec.free,
    priority: spec.priority,
  }));
}

export function catalog(): ProviderModel[] {
  const paidCap = Number(process.env.AI_PAID_DAILY_BUDGET_USD ?? "0");
  const models: ProviderModel[] = [];
  for (const spec of PROVIDERS) {
    const configured = spec.configured();
    const cap = spec.free ? null : paidCap;
    models.push({ provider: spec.id, tier: "cheap", model: modelName(spec, "cheap"), configured, estInputPerMTok: spec.inCheap, estOutputPerMTok: spec.outCheap, priority: spec.priority, free: spec.free, dailyCapUsd: cap });
    if (modelName(spec, "strong") !== modelName(spec, "cheap")) {
      models.push({ provider: spec.id, tier: "strong", model: modelName(spec, "strong"), configured, estInputPerMTok: spec.inStrong, estOutputPerMTok: spec.outStrong, priority: spec.priority, free: spec.free, dailyCapUsd: cap });
    }
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
  const usage = await db.query("select provider, model, task, ok, cached, latency_ms, estimated_cost, created_at, error from ai_usage order by created_at desc limit 80");
  const health = await db.query("select provider, cooldown_until, consecutive_failures, last_error, last_ok_at from ai_provider_state");
  const byProvider = new Map<string, { calls: number; errors: number; cost: number }>();
  for (const row of usage) {
    const key = String(row.provider);
    const current = byProvider.get(key) || { calls: 0, errors: 0, cost: 0 };
    current.calls += 1;
    if (!Number(row.ok)) current.errors += 1;
    current.cost += Number(row.estimated_cost || 0);
    byProvider.set(key, current);
  }
  const now = Date.now();
  return {
    configured: aiConfigured(),
    speaker: "PIKAS AI",
    providers: providerInfos().map((provider) => {
      const state = health.find((row) => row.provider === provider.id);
      const stats = byProvider.get(provider.id);
      const cooldownUntil = Number(state?.cooldown_until || 0);
      return {
        ...provider,
        healthy: provider.configured && cooldownUntil <= now,
        cooldownUntil: cooldownUntil > now ? cooldownUntil : null,
        consecutiveFailures: Number(state?.consecutive_failures || 0),
        lastError: state?.last_error ? String(state.last_error) : null,
        lastOkAt: state?.last_ok_at ? Number(state.last_ok_at) : null,
        recentCalls: stats?.calls || 0,
        recentErrors: stats?.errors || 0,
        estimatedCost: stats?.cost || 0,
      };
    }),
    pricesNote: "El coste es una estimación. Los motores gratuitos cuentan como 0. El usuario del chat no ve qué motor respondió.",
    spent,
    usage,
    chain: planChain({ now, task: "coordination", models: catalog(), health: health.map((row) => ({ provider: String(row.provider), cooldownUntil: Number(row.cooldown_until), consecutiveFailures: Number(row.consecutive_failures) })) }).map((item) => item.provider),
  };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export class ProviderCallError extends Error {
  status: number | null;
  constructor(status: number | null, message: string) {
    super(message);
    this.status = status;
  }
}

const OPENAI_COMPAT: Record<string, { url: string; key: () => string }> = {
  openai: { url: "https://api.openai.com/v1/chat/completions", key: () => process.env.OPENAI_API_KEY || "" },
  xai: { url: "https://api.x.ai/v1/chat/completions", key: () => process.env.XAI_API_KEY || "" },
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", key: () => process.env.GROQ_API_KEY || "" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", key: () => process.env.OPENROUTER_API_KEY || "" },
  cerebras: { url: "https://api.cerebras.ai/v1/chat/completions", key: () => process.env.CEREBRAS_API_KEY || "" },
  mistral: { url: "https://api.mistral.ai/v1/chat/completions", key: () => process.env.MISTRAL_API_KEY || "" },
  huggingface: { url: "https://router.huggingface.co/v1/chat/completions", key: () => process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY || "" },
};

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
  let parser: "openai" | "anthropic" | "gemini" | "cloudflare" = "openai";
  const system = input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  const dialogue = input.messages.filter((message) => message.role !== "system");
  const compat = OPENAI_COMPAT[input.provider];
  if (compat) {
    url = compat.url;
    headers = { ...headers, authorization: `Bearer ${compat.key()}` };
    if (input.provider === "openrouter") {
      headers["http-referer"] = process.env.APP_URL || "http://localhost:3000";
      headers["x-title"] = "PIKAS";
    }
    body = { model: input.model, stream: true, max_tokens: maxTokens, messages: input.messages.map(({ role, content }) => ({ role, content })) };
  } else if (input.provider === "ollama") {
    const base = (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
    url = `${base}/v1/chat/completions`;
    if (process.env.OLLAMA_API_KEY) headers.authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;
    body = { model: input.model, stream: true, messages: input.messages.map(({ role, content }) => ({ role, content })) };
  } else if (input.provider === "anthropic") {
    parser = "anthropic";
    url = "https://api.anthropic.com/v1/messages";
    headers = { ...headers, "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" };
    body = { model: input.model, max_tokens: maxTokens, stream: true, system, messages: dialogue.map((message) => ({ role: message.role, content: message.content })) };
  } else if (input.provider === "cloudflare") {
    parser = "cloudflare";
    url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${input.model}`;
    headers = { ...headers, authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN || ""}` };
    body = { messages: input.messages.map(({ role, content }) => ({ role, content })) };
  } else {
    parser = "gemini";
    url = `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(process.env.GEMINI_API_KEY || "")}`;
    body = {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: dialogue.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
      generationConfig: { maxOutputTokens: maxTokens },
    };
  }
  const response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: input.signal ?? AbortSignal.timeout(8000) });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new ProviderCallError(response.status, detail.slice(0, 300));
  }
  if (parser === "cloudflare") {
    const json = (await response.json()) as { result?: { response?: string } };
    const text = json.result?.response || "";
    if (!text) throw new ProviderCallError(502, "respuesta vacía");
    input.onDelta(text);
    return { content: text, promptTokens: null, completionTokens: null };
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
    const deltas = parser === "anthropic" ? parseAnthropicSse(chunk) : parser === "gemini" ? parseGemini(chunk) : parseOpenAiSse(chunk);
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

async function remember(db: Db, userId: string, note: string) {
  const rows = await db.query<{ summary: string }>("select summary from ai_memory where user_id = $1", [userId]);
  const lines = `${rows[0]?.summary || ""}\n${note}`.split("\n").map((line) => line.trim()).filter(Boolean);
  const summary = lines.slice(-12).join("\n").slice(0, 1200);
  await db.query(
    `insert into ai_memory (user_id, summary, updated_at) values ($1,$2,$3)
     on conflict (user_id) do update set summary = excluded.summary, updated_at = excluded.updated_at`,
    [userId, summary, Date.now()],
  );
}

export async function runRoutedChat(input: {
  db: Db;
  userId: string;
  task: TaskKind;
  messages: ChatMessage[];
  onDelta?: (text: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; content: string; cached: boolean } | { ok: false; error: string; code: string }> {
  if (!aiConfigured()) return { ok: false, error: "PIKAS AI no configurado", code: "not_configured" };
  const now = Date.now();
  const healthRows = await input.db.query<{ provider: string; cooldown_until: number; consecutive_failures: number }>(
    "select provider, cooldown_until, consecutive_failures from ai_provider_state",
  );
  const usage = await input.db.query<{ provider: string; estimated_cost: string | null }>(
    "select provider, estimated_cost from ai_usage where ok = 1 and created_at > $1",
    [now - 24 * 3600_000],
  );
  const spentByProvider: Record<string, number> = {};
  for (const row of usage) spentByProvider[row.provider] = (spentByProvider[row.provider] || 0) + Number(row.estimated_cost || 0);
  const chain = planChain({
    now,
    task: input.task,
    models: catalog(),
    health: healthRows.map((row) => ({ provider: row.provider, cooldownUntil: Number(row.cooldown_until), consecutiveFailures: Number(row.consecutive_failures) })),
    spentByProvider,
  });
  if (!chain.length) {
    return { ok: false, error: "PIKAS AI está en pausa: los motores configurados no tienen cupo ahora.", code: "cooldown" };
  }
  const memory = await input.db.query<{ summary: string }>("select summary from ai_memory where user_id = $1", [input.userId]);
  const packed = input.messages.map((message) => {
    if (message.role !== "system") return message;
    const extra = memory[0]?.summary ? `\nMemoria de este usuario, dicha por él, no son precios:\n${memory[0].summary}` : "";
    return { ...message, content: compressContext(`${message.content}${extra}`, 12000).text };
  });
  const failed = new Set<string>();
  for (const model of chain) {
    if (failed.has(model.provider)) continue;
    const started = Date.now();
    try {
      const result = await streamModel({
        provider: model.provider,
        model: model.model,
        messages: packed,
        fetchImpl: input.fetchImpl,
        onDelta: () => undefined,
      });
      const split = splitMemory(result.content);
      if (split.memory) await remember(input.db, input.userId, split.memory);
      for (const chunk of streamChunks(split.visible)) input.onDelta?.(chunk);
      const spec = catalog().find((item) => item.provider === model.provider && item.model === model.model);
      const estimated = estimateCostUsd(spec, result.promptTokens || 0, result.completionTokens || 0);
      await input.db.query(
        `insert into ai_usage (id, user_id, provider, model, task, prompt_tokens, completion_tokens, estimated_cost, latency_ms, cached, ok, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,1,$10)`,
        [crypto.randomUUID(), input.userId, model.provider, model.model, input.task, result.promptTokens, result.completionTokens, estimated, Date.now() - started, Date.now()],
      );
      await input.db.query(
        `insert into ai_provider_state (provider, cooldown_until, consecutive_failures, last_error, last_ok_at, updated_at)
         values ($1,0,0,null,$2,$2)
         on conflict (provider) do update set cooldown_until = 0, consecutive_failures = 0, last_error = null, last_ok_at = $2, updated_at = $2`,
        [model.provider, Date.now()],
      );
      return { ok: true, content: split.visible, cached: false };
    } catch (error) {
      failed.add(model.provider);
      const status = error instanceof ProviderCallError ? error.status : null;
      const raw = error instanceof Error ? error.message : "error";
      const kind = classifyProviderFailure(status, raw);
      const until = Date.now() + cooldownMs(kind);
      await input.db.query(
        `insert into ai_provider_state (provider, cooldown_until, consecutive_failures, last_error, updated_at)
         values ($1,$2,1,$3,$4)
         on conflict (provider) do update set
           cooldown_until = excluded.cooldown_until,
           consecutive_failures = ai_provider_state.consecutive_failures + 1,
           last_error = excluded.last_error,
           updated_at = excluded.updated_at`,
        [model.provider, until, raw.slice(0, 300), Date.now()],
      );
      await input.db.query(
        `insert into ai_usage (id, user_id, provider, model, task, latency_ms, cached, ok, error, created_at)
         values ($1,$2,$3,$4,$5,$6,0,0,$7,$8)`,
        [crypto.randomUUID(), input.userId, model.provider, model.model, input.task, Date.now() - started, `${kind}`.slice(0, 300), Date.now()],
      );
    }
  }
  return { ok: false, error: "PIKAS AI no pudo responder ahora. Los motores configurados fallaron o están en pausa.", code: "provider_error" };
}

export const PIKAS_SYSTEM = PIKAS_PERSONA;
