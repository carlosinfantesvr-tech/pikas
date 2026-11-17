import { advanceBattles } from "./battle";
import type { Db } from "./db";
import { logEvent } from "./db";
import { loadCandles, listQuotes, refreshMarket, type CandleDraft } from "./market";
import { dueFreeSymbols, maybeDailyBrief, refreshSentiment, settleFree, tickRondas } from "./ronda";
import { notifyResolvedRondas } from "./notify";
import { catchUpAccount, type QuoteView } from "./trading";

function asQuotes(rows: Awaited<ReturnType<typeof listQuotes>>): QuoteView[] {
  return rows.map((row) => ({
    symbol: row.symbol,
    price: row.price,
    executable: row.executable,
    source: row.source,
    status: row.status,
    providerTs: row.providerTs,
    fetchedAt: row.fetchedAt,
  }));
}

async function evaluateAlerts(db: Db, quotes: Awaited<ReturnType<typeof listQuotes>>, now: number) {
  const alerts = await db.query<Record<string, unknown>>("select * from alerts where enabled = 1");
  for (const alert of alerts) {
    const quote = quotes.find((item) => item.symbol === alert.symbol);
    if (!quote?.executable || !quote.price) continue;
    const last = alert.last_fired_at ? Number(alert.last_fired_at) : 0;
    if (now - last < 4 * 3600_000) continue;
    const price = Number(quote.price);
    const threshold = Number(alert.threshold);
    let hit = false;
    if (alert.kind === "price_above") hit = price >= threshold;
    if (alert.kind === "price_below") hit = price <= threshold;
    if (alert.kind === "move_pct") hit = quote.changeValue != null && Math.abs(Number(quote.changeValue)) >= threshold;
    if (!hit) continue;
    await db.query("update alerts set last_fired_at = $1 where id = $2", [now, alert.id]);
    await db.query(
      "insert into notifications (id, user_id, category, title, body, created_at) values ($1,$2,'mercado',$3,$4,$5)",
      [crypto.randomUUID(), alert.user_id, `Alerta ${alert.symbol}`, `${alert.kind} en ${quote.source}. Precio ${quote.price}. Estado ${quote.status}.`, now],
    );
  }
  const settings = await db.query<{ user_id: string; alert_move_pct: string }>("select user_id, alert_move_pct from user_settings");
  const full = await listQuotes(db);
  for (const setting of settings) {
    const threshold = Number(setting.alert_move_pct || 3);
    for (const quote of full) {
      if (!quote.executable || quote.changeValue == null || !["BTC", "ETH", "SOL"].includes(quote.symbol)) continue;
      if (Math.abs(Number(quote.changeValue)) < threshold) continue;
      const recent = await db.query(
        "select id from notifications where user_id = $1 and category = 'mercado' and title = $2 and created_at > $3 limit 1",
        [setting.user_id, `Movimiento ${quote.symbol}`, now - 4 * 3600_000],
      );
      if (recent.length) continue;
      const basis = quote.changeBasis === "24h" ? "24 h" : quote.changeBasis === "day_open" ? "desde la apertura" : "respecto al cierre previo";
      await db.query(
        "insert into notifications (id, user_id, category, title, body, created_at) values ($1,$2,'mercado',$3,$4,$5)",
        [crypto.randomUUID(), setting.user_id, `Movimiento ${quote.symbol}`, `${quote.symbol} se mueve ${Number(quote.changeValue).toFixed(2)}% ${basis} según ${quote.source}. No es una señal de un modelo.`, now],
      );
    }
  }
}

export async function runPulse(db: Db, fetchImpl: typeof fetch = fetch, now = Date.now()) {
  const lock = await db.query<{ locked_until: number }>("select locked_until from pulse_lock where id = 1");
  if (lock[0] && Number(lock[0].locked_until) > now) return { skipped: true as const };
  await db.query("update pulse_lock set locked_until = $1 where id = 1", [now + 20_000]);
  try {
    const market = await refreshMarket(db, fetchImpl, now);
    const listed = await listQuotes(db);
    const quotes = asQuotes(listed);
    const accounts = await db.query<{ id: string }>("select id from accounts where status = 'active' limit 30");
    const candleCache = new Map<string, CandleDraft[]>();
    for (const account of accounts) {
      const openSymbols = await db.query<{ symbol: string }>(
        "select distinct symbol from positions where account_id = $1 and status = 'open' union select distinct symbol from orders where account_id = $1 and status = 'pending'",
        [account.id],
      );
      const candleMap: Record<string, CandleDraft[]> = {};
      for (const row of openSymbols) {
        if (!candleCache.has(row.symbol)) {
          const loaded = await loadCandles(db, row.symbol, "1m", fetchImpl);
          candleCache.set(row.symbol, loaded.candles);
        }
        candleMap[row.symbol] = candleCache.get(row.symbol) || [];
      }
      const fundingRows = await db.query<{ symbol: string; rate: string; fetched_at: number; status: string }>("select symbol, rate, fetched_at, status from funding_rates");
      const funding: Record<string, { rate: string; fresh: boolean }> = {};
      for (const row of fundingRows) {
        if (!row.rate) continue;
        funding[row.symbol] = { rate: String(row.rate), fresh: row.status === "live" && now - Number(row.fetched_at) < 120_000 };
      }
      await catchUpAccount(db, account.id, quotes, candleMap, funding, now);
    }
    await advanceBattles(db, quotes, async (symbol, from, to) => {
      if (!candleCache.has(symbol)) {
        const loaded = await loadCandles(db, symbol, "1m", fetchImpl);
        candleCache.set(symbol, loaded.candles);
      }
      return (candleCache.get(symbol) || []).filter((candle) => candle.ts >= from && candle.ts <= to);
    }, now);
    const rondaSymbol = process.env.PIKAS_RONDA_SYMBOL || "BTC";
    if (!candleCache.has(rondaSymbol)) {
      const loaded = await loadCandles(db, rondaSymbol, "1m", fetchImpl);
      candleCache.set(rondaSymbol, loaded.candles);
    }
    const rondaQuote = listed.find((item) => item.symbol === rondaSymbol);
    await tickRondas(db, {
      now,
      quote: rondaQuote?.price ? { price: rondaQuote.price, source: rondaQuote.source || "sin fuente", executable: rondaQuote.executable } : null,
      candles: candleCache.get(rondaSymbol) || [],
      symbol: rondaSymbol,
    });
    await notifyResolvedRondas(db, now);
    for (const symbol of await dueFreeSymbols(db, now)) {
      if (!candleCache.has(symbol)) {
        const loaded = await loadCandles(db, symbol, "1m", fetchImpl);
        candleCache.set(symbol, loaded.candles);
      }
      await settleFree(db, symbol, candleCache.get(symbol) || [], now);
    }
    await refreshSentiment(db, fetchImpl, now);
    await maybeDailyBrief(db, now);
    await evaluateAlerts(db, listed, now);
    await db.query("update pulse_lock set locked_until = 0, last_run_at = $1, last_error = null where id = 1", [now]);
    if (market.failed.length) await logEvent(db, "warn", "market", "Alguna fuente de mercado falló", { failed: market.failed.slice(0, 8) });
    return { skipped: false as const, market, quotes };
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    await db.query("update pulse_lock set locked_until = 0, last_error = $1 where id = 1", [message.slice(0, 300)]);
    await logEvent(db, "error", "pulse", message);
    throw error;
  }
}
