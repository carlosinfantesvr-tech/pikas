export type TaskKind = "simple" | "market_analysis" | "coordination" | "trading_decision" | "summary";

export interface ProviderModel {
  provider: string;
  tier: "cheap" | "strong";
  model: string;
  configured: boolean;
  estInputPerMTok: number;
  estOutputPerMTok: number;
  /** Menor número = se intenta antes. Los gratuitos van por delante. */
  priority?: number;
  free?: boolean;
  dailyCapUsd?: number | null;
}

export interface Choice {
  ok: true;
  provider: ProviderModel["provider"];
  model: string;
  tier: "cheap" | "strong";
  reason: string;
}

export interface ChoiceFailure {
  ok: false;
  code: "not_configured" | "budget";
  reason: string;
}

const STRONG_TASKS = new Set<TaskKind>(["market_analysis", "coordination", "trading_decision"]);

export function chooseModel(input: {
  task: TaskKind;
  models: ProviderModel[];
  preference?: string | null;
  spentToday: number;
  spentMonth: number;
  dailyBudget: number;
  monthlyBudget: number;
}): Choice | ChoiceFailure {
  const configured = input.models.filter((m) => m.configured && m.model);
  if (configured.length === 0) {
    return {
      ok: false,
      code: "not_configured",
      reason: "Ningún proveedor de IA tiene clave. PIKAS AI no está configurado.",
    };
  }
  if (input.spentToday >= input.dailyBudget || input.spentMonth >= input.monthlyBudget) {
    return {
      ok: false,
      code: "budget",
      reason: "Se alcanzó el presupuesto estimado de IA. No se hacen más llamadas.",
    };
  }
  const wantStrong = STRONG_TASKS.has(input.task);
  const preferred = input.preference
    ? configured.filter((m) => m.provider === input.preference)
    : [];
  const pool = preferred.length ? preferred : configured;
  const tierPool = pool.filter((m) => (wantStrong ? m.tier === "strong" : m.tier === "cheap"));
  const chosen = (tierPool[0] ?? pool.find((m) => m.tier === "cheap") ?? pool[0])!;
  const downgraded = wantStrong && chosen.tier === "cheap";
  return {
    ok: true,
    provider: chosen.provider,
    model: chosen.model,
    tier: chosen.tier,
    reason: downgraded
      ? `No hay modelo potente configurado en la preferencia. Se usa ${chosen.provider}/${chosen.model}.`
      : `Tarea ${input.task}: ${chosen.provider}/${chosen.model}.`,
  };
}

export function fallbackOrder(models: ProviderModel[], first: { provider: string; model: string }): ProviderModel[] {
  const configured = models.filter((m) => m.configured);
  const head = configured.find((m) => m.provider === first.provider && m.model === first.model);
  const rest = configured.filter((m) => m !== head);
  return head ? [head, ...rest] : rest;
}

export function estimateCostUsd(model: ProviderModel | undefined, promptTokens: number, completionTokens: number): number | null {
  if (!model) return null;
  const cost = (promptTokens / 1_000_000) * model.estInputPerMTok + (completionTokens / 1_000_000) * model.estOutputPerMTok;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function compressContext(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const marker = "\n…[contexto recortado]…\n";
  if (maxChars <= marker.length + 2) return { text: text.slice(0, Math.max(1, maxChars)), truncated: true };
  const budget = maxChars - marker.length;
  const head = Math.max(1, Math.ceil(budget * 0.7));
  const tail = Math.max(0, budget - head);
  return { text: `${text.slice(0, head)}${marker}${tail ? text.slice(-tail) : ""}`, truncated: true };
}

export type FailureKind = "rate_limit" | "quota" | "timeout" | "auth" | "server" | "network";

export interface ProviderHealth {
  provider: string;
  cooldownUntil: number;
  consecutiveFailures: number;
}

export function classifyProviderFailure(status: number | null, message: string): FailureKind {
  const text = message.toLowerCase();
  if (status === 429 || /rate limit|too many requests|resource exhausted/.test(text)) return "rate_limit";
  if (status === 402 || status === 403 && /quota|credit|billing|insufficient/.test(text) || /quota|credit|billing|insufficient_quota|exceeded your/.test(text)) {
    return "quota";
  }
  if (status === 401 || status === 403) return "auth";
  if (status === 408 || /timeout|aborted|timed out/.test(text)) return "timeout";
  if (status != null && status >= 500) return "server";
  if (status == null) return /timeout|aborted|network|fetch failed|econnrefused/.test(text) ? "timeout" : "network";
  return "server";
}

export function cooldownMs(kind: FailureKind): number {
  if (kind === "quota") return 15 * 60_000;
  if (kind === "rate_limit") return 60_000;
  if (kind === "auth") return 60 * 60_000;
  if (kind === "timeout") return 30_000;
  if (kind === "server") return 45_000;
  return 20_000;
}

export function planChain(input: {
  now: number;
  task: TaskKind;
  models: ProviderModel[];
  health?: ProviderHealth[];
  spentByProvider?: Record<string, number>;
}): ProviderModel[] {
  const health = new Map((input.health || []).map((row) => [row.provider, row]));
  const spent = input.spentByProvider || {};
  const wantStrong = STRONG_TASKS.has(input.task);
  const usable = input.models.filter((model) => {
    if (!model.configured || !model.model) return false;
    const state = health.get(model.provider);
    if (state && state.cooldownUntil > input.now) return false;
    const cap = model.dailyCapUsd;
    if (cap != null && cap >= 0 && (spent[model.provider] || 0) >= cap) return false;
    return true;
  });
  return usable.sort((a, b) => {
    const pa = a.priority ?? 100;
    const pb = b.priority ?? 100;
    if (pa !== pb) return pa - pb;
    if (a.provider === b.provider && a.tier !== b.tier) {
      if (wantStrong) return a.tier === "strong" ? -1 : 1;
      return a.tier === "cheap" ? -1 : 1;
    }
    return 0;
  });
}

export function cacheKey(parts: string[]): string {
  // FNV-1a 32-bit, suficiente para la caché local. No es un secreto.
  let hash = 0x811c9dc5;
  const input = parts.join("\u001f");
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
