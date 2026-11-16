import { baselineDecision } from "../engine/baseline";
import { latestIndicators, type Bar } from "../engine/indicators";
import { callOneProvider, providerInfos } from "./ai";
import type { Db } from "./db";
import { closeUserPosition, createUserAccount, getUserAccount, placeUserOrder, type QuoteView } from "./trading";

async function agentAccount(db: Db, agentId: string, label: string): Promise<string> {
  const rows = await db.query<{ account_id: string | null }>("select account_id from agents where id = $1", [agentId]);
  if (rows[0]?.account_id) return rows[0].account_id;
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.query(
    `insert into accounts (id, owner_type, owner_id, label, initial_balance, balance, status, is_demo, created_at, last_processed_at)
     values ($1,'agent',$2,$3,'100','100.00000000','active',0,$4,$4)`,
    [id, agentId, label, now],
  );
  await db.query("update agents set account_id = $1 where id = $2", [id, agentId]);
  return id;
}

export interface ArenaSlot {
  slug: string;
  name: string;
  provider: string;
  model: string;
  configured: boolean;
  description: string;
}

export function arenaSlots(): ArenaSlot[] {
  const slots: ArenaSlot[] = [];
  for (const info of providerInfos()) {
    const models = info.cheap === info.strong ? [info.cheap] : [info.cheap, info.strong];
    models.forEach((model, index) => {
      const slug = models.length === 1 ? info.id : `${info.id}-${index === 0 ? "rapido" : "fuerte"}`;
      slots.push({
        slug,
        name: models.length === 1 ? info.label : `${info.label} ${index === 0 ? "rápido" : "fuerte"}`,
        provider: info.id,
        model,
        configured: info.configured,
        description: info.configured
          ? `Compite con ${model}. Cuenta simulada propia. Se activa con su variable de entorno.`
          : "No configurado. No opera ni inventa operaciones hasta que exista su variable de entorno.",
      });
    });
  }
  return slots;
}

export async function syncArenaAgents(db: Db): Promise<void> {
  const baseline = await db.query("select id from agents where slug = 'baseline'");
  if (!baseline.length) {
    await db.query(
      "insert into agents (id, slug, name, kind, provider, description) values ($1,'baseline','Baseline técnico','rules',null,$2)",
      [crypto.randomUUID(), "Reglas EMA/RSI sobre velas reales. No es un modelo de lenguaje."],
    );
  }
  for (const slot of arenaSlots()) {
    const found = await db.query<{ id: string }>("select id from agents where slug = $1", [slot.slug]);
    if (!found.length) {
      await db.query(
        "insert into agents (id, slug, name, kind, provider, description) values ($1,$2,$3,'llm',$4,$5)",
        [crypto.randomUUID(), slot.slug, slot.name, slot.provider, slot.description],
      );
    } else {
      await db.query("update agents set name = $1, provider = $2, description = $3 where slug = $4", [
        slot.name,
        slot.provider,
        slot.description,
        slot.slug,
      ]);
    }
  }
}

function parseArenaDecision(text: string): { action: "hold" | "open_long" | "open_short" | "close"; confidence: string | null; risk: string | null; tp: string | null; sl: string | null; rationale: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[0]) as { action?: string; confidence?: number; risk?: string; tp?: number | null; sl?: number | null; rationale?: string };
    if (!json.action || !["hold", "open_long", "open_short", "close"].includes(json.action)) return null;
    return {
      action: json.action as "hold" | "open_long" | "open_short" | "close",
      confidence: json.confidence == null ? null : String(json.confidence),
      risk: json.risk || null,
      tp: json.tp == null ? null : String(json.tp),
      sl: json.sl == null ? null : String(json.sl),
      rationale: json.rationale || "Sin explicación.",
    };
  } catch {
    return null;
  }
}

export async function runArena(
  db: Db,
  userId: string,
  input: { symbol: string; mode: "competition" | "assisted" | "autonomous"; bars: Bar[]; quote: QuoteView },
  now = Date.now(),
  fetchImpl?: typeof fetch,
) {
  if (!input.quote.executable || !input.quote.price) {
    return { ok: false as const, error: "No hay un precio ejecutable para la arena.", code: "STALE_PRICE" };
  }
  const indicator = latestIndicators(input.bars);
  const context = {
    symbol: input.symbol,
    price: input.quote.price,
    source: input.quote.source,
    providerTs: input.quote.providerTs,
    indicator,
    note: "Todos los agentes reciben este mismo bloque.",
  };
  const runId = crypto.randomUUID();
  await db.query(
    `insert into arena_runs (id, created_by, symbol, mode, price, price_source, price_ts, context_json, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [runId, userId, input.symbol, input.mode, input.quote.price, input.quote.source, input.quote.providerTs, JSON.stringify(context), now],
  );
  await syncArenaAgents(db);
  const slots = new Map(arenaSlots().map((slot) => [slot.slug, slot]));
  const agents = await db.query<Record<string, unknown>>("select * from agents");
  const decisions = [];
  const sharedPrompt = "Todos recibís el mismo contexto. Responde solo JSON con action (hold|open_long|open_short|close), confidence (0-1, autodeclarada, no es una probabilidad), risk, tp, sl, rationale. Simulación educativa. No inventes precios distintos a los del contexto.";
  for (const agent of agents) {
    if (agent.kind === "rules") {
      const accountId = await agentAccount(db, String(agent.id), String(agent.name));
      const openPositions = await db.query<{ id: string; side: string }>(
        "select id, side from positions where account_id = $1 and status = 'open' and symbol = $2",
        [accountId, input.symbol],
      );
      const decision = baselineDecision({
        ema20: indicator?.ema20 ?? null,
        ema50: indicator?.ema50 ?? null,
        rsi14: indicator?.rsi14 ?? null,
        atr14: indicator?.atr14 ?? null,
        price: Number(input.quote.price),
        hasLong: openPositions.some((position) => position.side === "long"),
        hasShort: openPositions.some((position) => position.side === "short"),
      });
      let executed = 0;
      let executionNote = "Modo asistido: no se ejecuta solo.";
      if (input.mode !== "assisted" && decision.action !== "hold") {
        const view = { ...input.quote };
        if (decision.action === "open_long" || decision.action === "open_short") {
          const placed = await placeUserOrder(
            db,
            accountId,
            { symbol: input.symbol, side: decision.action === "open_long" ? "long" : "short", type: "market", margin: "10", leverage: 2 },
            view,
            now,
          );
          executed = placed.ok ? 1 : 0;
          executionNote = placed.ok ? "Ejecutado en la cuenta del agente de reglas." : placed.error;
        } else if (decision.action === "close" && openPositions[0]) {
          const closed = await closeUserPosition(db, accountId, openPositions[0].id, 100, view, now);
          executed = closed.ok ? 1 : 0;
          executionNote = closed.ok ? "Cierre ejecutado en la cuenta del agente de reglas." : closed.error;
        }
      } else if (decision.action === "hold") executionNote = "La regla no opera.";
      const row = {
        id: crypto.randomUUID(),
        action: decision.action,
        rationale: decision.rationale,
        provider: "rules",
        model: "ema-rsi",
        executed,
        executionNote,
        selfReported: 0,
      };
      await db.query(
        `insert into agent_decisions (id, run_id, agent_id, symbol, price, action, confidence, risk, tp, sl, rationale, provider, model, created_at, executed, execution_note, self_reported)
         values ($1,$2,$3,$4,$5,$6,null,$7,$8,$9,$10,$11,$12,$13,$14,$15,0)`,
        [row.id, runId, agent.id, input.symbol, input.quote.price, decision.action, decision.risk, decision.tp, decision.sl, decision.rationale, "rules", "ema-rsi", now, executed, executionNote],
      );
      decisions.push({ agent: agent.slug, ...row, configured: true });
      continue;
    }
    const slot = slots.get(String(agent.slug));
    if (!slot) continue;
    if (!slot.configured) {
      const id = crypto.randomUUID();
      await db.query(
        `insert into agent_decisions (id, run_id, agent_id, symbol, price, action, rationale, provider, model, created_at, executed, execution_note, self_reported)
         values ($1,$2,$3,$4,$5,'unavailable',$6,$7,$8,$9,0,'No configurado',0)`,
        [id, runId, agent.id, input.symbol, input.quote.price, "No configurado. No hay operación.", slot.provider, slot.model, now],
      );
      decisions.push({ agent: slot.slug, id, action: "unavailable", configured: false, rationale: "No configurado. No hay operación.", provider: slot.provider, model: slot.model });
      continue;
    }
    const result = await callOneProvider({
      provider: slot.provider,
      model: slot.model,
      fetchImpl,
      messages: [
        { role: "system", content: sharedPrompt },
        { role: "user", content: JSON.stringify(context) },
      ],
    });
    const parsed = result.ok ? parseArenaDecision(result.content) : null;
    let executed = 0;
    let executionNote = result.ok ? "Propuesta registrada." : result.error;
    if (parsed && input.mode !== "assisted" && parsed.action !== "hold") {
      const accountId = await agentAccount(db, String(agent.id), slot.name);
      const openPositions = await db.query<{ id: string; side: string }>(
        "select id, side from positions where account_id = $1 and status = 'open' and symbol = $2",
        [accountId, input.symbol],
      );
      if (parsed.action === "close" && openPositions[0]) {
        const closed = await closeUserPosition(db, accountId, openPositions[0].id, 100, input.quote, now);
        executed = closed.ok ? 1 : 0;
        executionNote = closed.ok ? "Cierre en la cuenta de este agente." : closed.error;
      } else if (parsed.action === "open_long" || parsed.action === "open_short") {
        const placed = await placeUserOrder(
          db,
          accountId,
          { symbol: input.symbol, side: parsed.action === "open_long" ? "long" : "short", type: "market", margin: "10", leverage: 2 },
          input.quote,
          now,
        );
        executed = placed.ok ? 1 : 0;
        executionNote = placed.ok ? "Orden simulada en la cuenta de este agente." : placed.error;
      }
    } else if (parsed?.action === "hold") executionNote = "Decide mantenerse. No hay orden.";
    else if (result.ok && !parsed) executionNote = "La respuesta no era una decisión válida. No se operó.";
    const id = crypto.randomUUID();
    await db.query(
      `insert into agent_decisions (id, run_id, agent_id, symbol, price, action, confidence, risk, tp, sl, rationale, provider, model, created_at, executed, execution_note, self_reported)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,1)`,
      [
        id, runId, agent.id, input.symbol, input.quote.price,
        parsed?.action || (result.ok ? "invalid" : "error"),
        parsed?.confidence || null, parsed?.risk || null, parsed?.tp || null, parsed?.sl || null,
        parsed?.rationale || executionNote,
        slot.provider, slot.model, now, executed, executionNote,
      ],
    );
    decisions.push({ agent: slot.slug, id, configured: true, action: parsed?.action || "error", provider: slot.provider, model: slot.model, executed });
  }
  return { ok: true as const, runId, decisions, context };
}

export async function arenaBoard(db: Db) {
  await syncArenaAgents(db);
  const slots = new Map(arenaSlots().map((slot) => [slot.slug, slot]));
  const agents = await db.query<Record<string, unknown>>("select id, slug, name, kind, provider, description, account_id from agents order by kind desc, name");
  const decisions = await db.query("select * from agent_decisions order by created_at desc limit 60");
  const runs = await db.query("select * from arena_runs order by created_at desc limit 10");
  return {
    agents: agents.map((agent) => ({
      ...agent,
      configured: agent.kind === "rules" ? true : Boolean(slots.get(String(agent.slug))?.configured),
      model: slots.get(String(agent.slug))?.model || null,
    })),
    decisions,
    runs,
  };
}

export { getUserAccount, createUserAccount, closeUserPosition };
