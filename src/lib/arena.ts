import { baselineDecision } from "../engine/baseline";
import { latestIndicators, type Bar } from "../engine/indicators";
import { aiConfigured, runRoutedChat } from "./ai";
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

export async function runArena(
  db: Db,
  userId: string,
  input: { symbol: string; mode: "competition" | "assisted" | "autonomous"; bars: Bar[]; quote: QuoteView },
  now = Date.now(),
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
  const agents = await db.query<Record<string, unknown>>("select * from agents");
  const decisions = [];
  let pikasAsked = false;
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
    if (pikasAsked) continue;
    pikasAsked = true;
    if (!aiConfigured()) {
      const id = crypto.randomUUID();
      await db.query(
        `insert into agent_decisions (id, run_id, agent_id, symbol, price, action, rationale, provider, model, created_at, executed, execution_note, self_reported)
         values ($1,$2,$3,$4,$5,'unavailable',$6,'pikas','PIKAS AI',$7,0,$8,0)`,
        [id, runId, agent.id, input.symbol, input.quote.price, "PIKAS AI no configurado. No hay decisión.", now, "Sin motor"],
      );
      decisions.push({ agent: "pikas", id, action: "unavailable", configured: false, rationale: "PIKAS AI no configurado." });
      continue;
    }
    const result = await runRoutedChat({
      db,
      userId,
      task: "trading_decision",
      messages: [
        { role: "system", content: "Eres PIKAS AI. Responde solo JSON con action (hold|open_long|open_short|close), confidence (0-1, autodeclarada, no es una probabilidad), risk, tp, sl, rationale. Simulación educativa. No nombres otros motores." },
        { role: "user", content: JSON.stringify(context) },
      ],
    });
    const id = crypto.randomUUID();
    await db.query(
      `insert into agent_decisions (id, run_id, agent_id, symbol, price, action, rationale, provider, model, created_at, executed, execution_note, self_reported)
       values ($1,$2,$3,$4,$5,$6,$7,'pikas','PIKAS AI',$8,0,$9,1)`,
      [
        id,
        runId,
        agent.id,
        input.symbol,
        input.quote.price,
        result.ok ? "proposed" : "error",
        result.ok ? result.content : result.error,
        now,
        result.ok ? "Propuesta de PIKAS AI. La confianza declarada no es una probabilidad calibrada." : result.error,
      ],
    );
    decisions.push({ agent: "pikas", id, configured: true, ok: result.ok });
  }
  return { ok: true as const, runId, decisions, context };
}

export async function arenaBoard(db: Db) {
  const agents = await db.query("select id, slug, name, kind, provider, description, account_id from agents order by kind desc, name");
  const decisions = await db.query("select * from agent_decisions order by created_at desc limit 40");
  const runs = await db.query("select * from arena_runs order by created_at desc limit 10");
  return { agents, decisions, runs };
}

export { getUserAccount, createUserAccount, closeUserPosition };
