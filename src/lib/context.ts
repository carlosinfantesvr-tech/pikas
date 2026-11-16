import type { Db } from "./db";
import { listQuotes } from "./market";
import { accountView, getUserAccount } from "./trading";

export async function buildPikasContext(db: Db, userId: string): Promise<string> {
  const quotes = await listQuotes(db);
  const account = await getUserAccount(db, userId);
  const view = account ? await accountView(db, account.id, quotes.map((quote) => ({
    symbol: quote.symbol,
    price: quote.price,
    executable: quote.executable,
    source: quote.source,
    status: quote.status,
    providerTs: quote.providerTs,
    fetchedAt: quote.fetchedAt,
  }))) : null;
  const battles = await db.query("select symbol, status, start_price, resolution, resolution_note from battles order by created_at desc limit 5");
  const arena = await db.query("select action, provider, rationale, created_at from agent_decisions order by created_at desc limit 5");
  const alerts = await db.query("select symbol, kind, threshold, enabled from alerts where user_id = $1", [userId]);
  const lines = [
    "CONTEXTO REAL (no completes los huecos):",
    `Generado: ${new Date().toISOString()}`,
    "Precios:",
    ...quotes.map((quote) =>
      quote.price
        ? `- ${quote.symbol}: ${quote.price} fuente ${quote.source} estado ${quote.status} base ${quote.changeBasis ?? "n/d"} cambio ${quote.changeValue ?? "n/d"}`
        : `- ${quote.symbol}: sin precio (${quote.detail || quote.status})`,
    ),
    view
      ? `Cuenta simulada: saldo ${view.balance} patrimonio ${view.equity} operaciones ${view.stats.trades} win rate ${view.stats.winRate ?? "n/d"}`
      : "Cuenta simulada: el usuario todavía no eligió saldo.",
    view?.positions.length
      ? `Posiciones: ${view.positions.map((position) => `${position.side} ${position.symbol} entrada ${position.entryPrice} marca ${position.mark ?? "n/d"} (${position.markStatus}) upnl ${position.upnl ?? "n/d"} liq ${position.liquidation}`).join("; ")}`
      : "Posiciones: ninguna.",
    battles.length ? `Market Battle reciente: ${JSON.stringify(battles)}` : "Market Battle: sin rondas.",
    arena.length ? `AI Arena reciente: ${JSON.stringify(arena)}` : "AI Arena: sin decisiones.",
    alerts.length ? `Alertas: ${JSON.stringify(alerts)}` : "Alertas: ninguna.",
  ];
  return lines.join("\n");
}
