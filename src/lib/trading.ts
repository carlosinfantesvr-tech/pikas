import { accountEquity, applyFunding, cancelOrder, closeMarket, liquidationPrice, openMarket, placePending, resetBalances, roe, setProtection, stepOnCandle, stepOnPrice, unrealizedPnl, type AccountSnap, type Position, type WorkingOrder } from "../engine/trading";
import { INITIAL_BALANCES, d, q, sub } from "../engine/money";
import type { Db } from "./db";
import { logEvent } from "./db";

export interface QuoteView {
  symbol: string;
  price: string | null;
  executable: boolean;
  source: string | null;
  status: string;
  providerTs: number | null;
  fetchedAt: number | null;
}

interface AccountRow {
  id: string;
  owner_type: string;
  owner_id: string;
  label: string;
  initial_balance: string;
  balance: string;
  status: string;
  is_demo: number;
  created_at: number;
  last_processed_at: number | null;
  last_funding_hour: number | null;
  catchup_note: string | null;
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function notify(db: Db, userId: string | null, category: string, title: string, body: string) {
  if (!userId) return;
  const prefs = await db.query<{ enabled: number }>(
    "select enabled from notification_prefs where user_id = $1 and category = $2",
    [userId, category],
  );
  if (prefs[0] && Number(prefs[0].enabled) === 0) return;
  await db.query(
    "insert into notifications (id, user_id, category, title, body, created_at) values ($1,$2,$3,$4,$5,$6)",
    [crypto.randomUUID(), userId, category, title, body, Date.now()],
  );
}

export async function getUserAccount(db: Db, userId: string): Promise<AccountRow | null> {
  const rows = await db.query<AccountRow>(
    "select * from accounts where owner_type = 'user' and owner_id = $1 and status = 'active' order by created_at asc limit 1",
    [userId],
  );
  return rows[0] ?? null;
}

export async function createUserAccount(db: Db, userId: string, initial: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!INITIAL_BALANCES.includes(initial as (typeof INITIAL_BALANCES)[number])) {
    return { ok: false, error: "El saldo inicial debe ser 10, 50, 100 o 500 USDT." };
  }
  const existing = await getUserAccount(db, userId);
  if (existing) return { ok: false, error: "Ya tienes una cuenta de simulación." };
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.query(
    `insert into accounts (id, owner_type, owner_id, label, initial_balance, balance, status, is_demo, created_at, last_processed_at)
     values ($1,'user',$2,'Principal',$3,$3,'active',0,$4,$4)`,
    [id, userId, q(initial), now],
  );
  await db.query(
    "insert into ledger (id, account_id, type, amount, balance_after, note, created_at) values ($1,$2,'apertura',$3,$3,'saldo inicial simulado',$4)",
    [crypto.randomUUID(), id, q(initial), now],
  );
  return { ok: true, id };
}

async function loadSnap(db: Db, accountId: string): Promise<{ account: AccountRow; snap: AccountSnap }> {
  const accounts = await db.query<AccountRow>("select * from accounts where id = $1", [accountId]);
  const account = accounts[0];
  if (!account) throw new Error("Cuenta no encontrada.");
  const positions = await db.query<Record<string, unknown>>(
    "select * from positions where account_id = $1 and status = 'open'",
    [accountId],
  );
  const orders = await db.query<Record<string, unknown>>(
    "select * from orders where account_id = $1 and status = 'pending'",
    [accountId],
  );
  const snap: AccountSnap = {
    balance: String(account.balance),
    positions: positions.map((row) => ({
      id: String(row.id),
      symbol: String(row.symbol),
      side: row.side as Position["side"],
      qty: String(row.qty),
      entryPrice: String(row.entry_price),
      margin: String(row.margin),
      leverage: Number(row.leverage),
      realizedPnl: String(row.realized_pnl),
      fees: String(row.fees),
      funding: String(row.funding),
      openedAt: Number(row.opened_at),
      tp: row.tp == null ? null : String(row.tp),
      sl: row.sl == null ? null : String(row.sl),
    })),
    orders: orders.map((row) => ({
      id: String(row.id),
      symbol: String(row.symbol),
      side: row.side as WorkingOrder["side"],
      intent: row.intent as WorkingOrder["intent"],
      type: row.type as WorkingOrder["type"],
      margin: row.margin == null ? null : String(row.margin),
      leverage: row.leverage == null ? null : Number(row.leverage),
      qty: row.qty == null ? null : String(row.qty),
      limitPrice: row.limit_price == null ? null : String(row.limit_price),
      stopPrice: row.stop_price == null ? null : String(row.stop_price),
      positionId: row.position_id == null ? null : String(row.position_id),
      createdAt: Number(row.created_at),
    })),
  };
  return { account, snap };
}

async function persist(
  db: Db,
  account: AccountRow,
  before: AccountSnap,
  after: AccountSnap,
  events: Array<{ type: string; symbol?: string; positionId?: string; orderId?: string; amount?: string; price?: string; fee?: string; note?: string; reason?: string }>,
  marks: Record<string, { price: string; source: string }>,
  now: number,
) {
  const userId = account.owner_type === "user" ? account.owner_id : null;
  await db.tx(async (tx) => {
    await tx.query("update accounts set balance = $1 where id = $2", [after.balance, account.id]);
    if (before.balance !== after.balance) {
      await tx.query(
        "insert into ledger (id, account_id, type, amount, balance_after, note, created_at) values ($1,$2,$3,$4,$5,$6,$7)",
        [crypto.randomUUID(), account.id, events[0]?.type || "ajuste", sub(after.balance, before.balance), after.balance, events.map((e) => e.type).join(","), now],
      );
    }
    for (const position of after.positions) {
      const mark = marks[position.symbol];
      await tx.query(
        `insert into positions (id, account_id, symbol, side, status, qty, entry_price, margin, leverage, realized_pnl, fees, funding, tp, sl, opened_at, last_mark, last_mark_at, last_mark_source)
         values ($1,$2,$3,$4,'open',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         on conflict (id) do update set qty = excluded.qty, entry_price = excluded.entry_price, margin = excluded.margin,
           leverage = excluded.leverage, realized_pnl = excluded.realized_pnl, fees = excluded.fees, funding = excluded.funding,
           tp = excluded.tp, sl = excluded.sl, status = 'open', last_mark = excluded.last_mark, last_mark_at = excluded.last_mark_at,
           last_mark_source = excluded.last_mark_source`,
        [
          position.id, account.id, position.symbol, position.side, position.qty, position.entryPrice, position.margin, position.leverage,
          position.realizedPnl, position.fees, position.funding, position.tp, position.sl, position.openedAt,
          mark?.price ?? null, mark ? now : null, mark?.source ?? null,
        ],
      );
    }
    for (const position of before.positions) {
      if (after.positions.some((item) => item.id === position.id)) continue;
      const event = events.find((item) => item.positionId === position.id && ["close", "liquidation"].includes(item.type));
      const realized = event?.type === "liquidation" ? q(d(position.margin).neg()) : q(d(position.realizedPnl).plus(event?.amount || 0));
      const fees = q(d(position.fees).plus(event?.fee || 0));
      await tx.query(
        `update positions set status = 'closed', qty = $2, margin = '0', realized_pnl = $3, fees = $4, funding = $5,
           closed_at = $6, close_price = $7, close_reason = $8 where id = $1`,
        [position.id, "0.00000000", realized, fees, position.funding, now, event?.price ?? null, event?.reason || event?.type || "close"],
      );
    }
    for (const event of events) {
      if (!["close", "partial_close", "liquidation"].includes(event.type) || !event.positionId) continue;
      const position = before.positions.find((item) => item.id === event.positionId);
      if (!position || !event.price) continue;
      await tx.query(
        `insert into trades (id, account_id, position_id, symbol, side, leverage, qty, entry_price, exit_price, realized_pnl, fee, reason, opened_at, closed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          crypto.randomUUID(),
          account.id,
          position.id,
          position.symbol,
          position.side,
          position.leverage,
          event.note && event.type !== "liquidation" ? event.note : position.qty,
          position.entryPrice,
          event.price,
          event.type === "liquidation" ? q(d(position.margin).neg()) : event.amount || "0",
          event.fee || "0",
          event.reason || event.type,
          position.openedAt,
          now,
        ],
      );
    }
    const pending = await tx.query<{ id: string }>("select id from orders where account_id = $1 and status = 'pending'", [account.id]);
    for (const row of pending) {
      if (after.orders.some((order) => order.id === row.id)) continue;
      const filled = events.find((event) => event.orderId === row.id && event.type === "order_filled");
      const cancelled = events.find((event) => event.orderId === row.id && event.type === "order_cancelled");
      await tx.query(
        "update orders set status = $2, updated_at = $3, filled_at = $4, fill_price = $5, note = $6 where id = $1",
        [row.id, filled ? "filled" : cancelled ? "cancelled" : "closed", now, filled ? now : null, filled?.price ?? null, filled?.reason || cancelled?.type || null],
      );
    }
    for (const order of after.orders) {
      await tx.query(
        `insert into orders (id, account_id, symbol, side, intent, type, status, margin, leverage, qty, limit_price, stop_price, position_id, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (id) do update set updated_at = excluded.updated_at, qty = excluded.qty, limit_price = excluded.limit_price, stop_price = excluded.stop_price`,
        [
          order.id, account.id, order.symbol, order.side, order.intent, order.type, order.margin, order.leverage, order.qty,
          order.limitPrice, order.stopPrice, order.positionId, order.createdAt, now,
        ],
      );
    }
  });

  for (const event of events) {
    if (event.type === "close" || event.type === "partial_close") {
      await notify(db, userId, event.reason === "take_profit" ? "tp" : event.reason === "stop_loss" ? "sl" : "orden", event.reason === "take_profit" ? "Take profit" : event.reason === "stop_loss" ? "Stop loss" : "Cierre simulado", `${event.symbol} a ${event.price}. PnL ${event.amount}.`);
    }
    if (event.type === "liquidation") {
      await notify(db, userId, "liquidacion", "Liquidación simulada", `${event.symbol} se liquidó en simulación a ${event.price}. No hay dinero real.`);
    }
    if (event.type === "order_filled") await notify(db, userId, "orden", "Orden ejecutada", `${event.symbol} se ejecutó a ${event.price}.`);
    if (event.type === "order_cancelled") await notify(db, userId, "orden", "Orden cancelada", "Se canceló una orden pendiente.");
    if (event.type === "ambiguous_candle" || event.type === "data_gap") {
      await logEvent(db, "warn", "trading", event.note || event.type, { symbol: event.symbol, accountId: account.id });
    }
  }
}

function requireQuote(quote: QuoteView | undefined, symbol: string): { ok: true; price: string; source: string } | { ok: false; error: string; code: string } {
  if (!quote || !quote.price || quote.status === "unavailable") {
    return { ok: false, error: `No hay precio real de ${symbol}.`, code: "NO_PRICE" };
  }
  if (!quote.executable) {
    return { ok: false, error: `El precio de ${symbol} no es ejecutable (${quote.status}). No se simula la orden.`, code: "STALE_PRICE" };
  }
  return { ok: true, price: quote.price, source: quote.source || "desconocida" };
}

export async function placeUserOrder(
  db: Db,
  accountId: string,
  input: { symbol: string; side: "long" | "short"; type: "market" | "limit" | "stop_market"; margin: string; leverage: number; limitPrice?: string; stopPrice?: string },
  quote: QuoteView | undefined,
  now = Date.now(),
) {
  const priced = requireQuote(quote, input.symbol);
  if (!priced.ok) return priced;
  const { account, snap } = await loadSnap(db, accountId);
  if (input.type === "market") {
    const result = openMarket(snap, {
      id: crypto.randomUUID(),
      symbol: input.symbol,
      side: input.side,
      margin: input.margin,
      leverage: input.leverage,
      price: priced.price,
      now,
    });
    if (!result.ok) return result;
    await persist(db, account, snap, result.state, result.events, { [input.symbol]: { price: priced.price, source: priced.source } }, now);
    return { ok: true as const, state: result.state };
  }
  const order: WorkingOrder = {
    id: crypto.randomUUID(),
    symbol: input.symbol,
    side: input.side,
    intent: "open",
    type: input.type,
    margin: input.margin,
    leverage: input.leverage,
    qty: null,
    limitPrice: input.limitPrice ?? null,
    stopPrice: input.stopPrice ?? null,
    positionId: null,
    createdAt: now,
  };
  const result = placePending(snap, order);
  if (!result.ok) return result;
  await persist(db, account, snap, result.state, result.events, {}, now);
  return { ok: true as const, state: result.state };
}

export async function closeUserPosition(db: Db, accountId: string, positionId: string, percent: number, quote: QuoteView | undefined, now = Date.now()) {
  const { account, snap } = await loadSnap(db, accountId);
  const position = snap.positions.find((item) => item.id === positionId);
  if (!position) return { ok: false as const, error: "La posición no existe.", code: "NO_POSITION" };
  const priced = requireQuote(quote, position.symbol);
  if (!priced.ok) return priced;
  const qty = percent >= 100 ? null : q((Number(position.qty) * percent) / 100);
  const result = closeMarket(snap, { positionId, qty, price: priced.price, now, reason: "market" });
  if (!result.ok) return result;
  await persist(db, account, snap, result.state, result.events, { [position.symbol]: { price: priced.price, source: priced.source } }, now);
  return { ok: true as const, state: result.state };
}

export async function protectUserPosition(
  db: Db,
  accountId: string,
  positionId: string,
  tp: string | null,
  sl: string | null,
  quote: QuoteView | undefined,
) {
  const { account, snap } = await loadSnap(db, accountId);
  const position = snap.positions.find((item) => item.id === positionId);
  if (!position) return { ok: false as const, error: "La posición no existe.", code: "NO_POSITION" };
  const priced = requireQuote(quote, position.symbol);
  if (!priced.ok) return priced;
  const result = setProtection(snap, { positionId, tp, sl, mark: priced.price });
  if (!result.ok) return result;
  await persist(db, account, snap, result.state, result.events, { [position.symbol]: { price: priced.price, source: priced.source } }, Date.now());
  return { ok: true as const };
}

export async function cancelUserOrder(db: Db, accountId: string, orderId: string) {
  const { account, snap } = await loadSnap(db, accountId);
  const result = cancelOrder(snap, orderId);
  if (!result.ok) return result;
  await persist(db, account, snap, result.state, result.events, {}, Date.now());
  return { ok: true as const };
}

export async function resetUserAccount(db: Db, accountId: string, initial: string, quotes: QuoteView[], now = Date.now()) {
  if (!INITIAL_BALANCES.includes(initial as (typeof INITIAL_BALANCES)[number])) {
    return { ok: false as const, error: "Saldo inicial no permitido.", code: "BAD_BALANCE" };
  }
  let loaded = await loadSnap(db, accountId);
  for (const position of [...loaded.snap.positions]) {
    const quote = quotes.find((item) => item.symbol === position.symbol);
    const closed = await closeUserPosition(db, accountId, position.id, 100, quote, now);
    if (!closed.ok) return closed;
  }
  loaded = await loadSnap(db, accountId);
  for (const order of [...loaded.snap.orders]) {
    const cancelled = cancelOrder(loaded.snap, order.id);
    if (cancelled.ok) {
      await persist(db, loaded.account, loaded.snap, cancelled.state, cancelled.events, {}, now);
      loaded = await loadSnap(db, accountId);
    }
  }
  const reset = resetBalances(loaded.snap, initial);
  if (!reset.ok) return reset;
  await persist(db, loaded.account, loaded.snap, reset.state, reset.events, {}, now);
  await db.query("update accounts set initial_balance = $1, balance = $2 where id = $3", [q(initial), q(initial), accountId]);
  return { ok: true as const };
}

export async function catchUpAccount(
  db: Db,
  accountId: string,
  quotes: QuoteView[],
  candleMap: Record<string, Array<{ ts: number; open: string; high: string; low: string; close: string }>>,
  funding: Record<string, { rate: string; fresh: boolean }>,
  now = Date.now(),
) {
  const loaded = await loadSnap(db, accountId);
  let state = loaded.snap;
  const events: Array<{ type: string; symbol?: string; positionId?: string; orderId?: string; amount?: string; price?: string; fee?: string; note?: string; reason?: string }> = [];
  const marks: Record<string, { price: string; source: string }> = {};
  const symbols = new Set([...state.positions.map((p) => p.symbol), ...state.orders.map((o) => o.symbol)]);
  const last = Number(loaded.account.last_processed_at || now);
  let fundingHour = loaded.account.last_funding_hour == null ? null : Number(loaded.account.last_funding_hour);
  let note: string | null = null;
  let fundedThisRun = false;

  for (const symbol of symbols) {
    const quote = quotes.find((item) => item.symbol === symbol);
    if (now - last > 90_000) {
      const candles = (candleMap[symbol] || []).filter((candle) => candle.ts > last && candle.ts <= now).sort((a, b) => a.ts - b.ts);
      let cursor = last;
      for (const candle of candles) {
        if (candle.ts - cursor > 180_000) {
          note = `Intervalo sin velas en ${symbol}. No se reconstruye el camino del precio.`;
          events.push({ type: "data_gap", symbol, note });
          await db.query(
            "insert into data_gaps (id, account_id, symbol, from_ts, to_ts, reason, created_at) values ($1,$2,$3,$4,$5,$6,$7)",
            [crypto.randomUUID(), accountId, symbol, cursor, candle.ts, note, now],
          );
          break;
        }
        const stepped = stepOnCandle(state, { symbol, candle, now: candle.ts });
        if (!stepped.ok) break;
        if (stepped.ambiguous) {
          note = `Vela ambigua en ${symbol}. No se liquida ni se ejecuta.`;
          events.push(...stepped.events);
          await db.query(
            "insert into data_gaps (id, account_id, symbol, from_ts, to_ts, reason, created_at) values ($1,$2,$3,$4,$5,$6,$7)",
            [crypto.randomUUID(), accountId, symbol, candle.ts, candle.ts + 60_000, note, now],
          );
          break;
        }
        state = stepped.state;
        events.push(...stepped.events);
        cursor = candle.ts;
      }
    }
    if (quote?.price && quote.executable) {
      const stepped = stepOnPrice(state, { symbol, price: quote.price, now, executable: true });
      if (stepped.ok) {
        state = stepped.state;
        events.push(...stepped.events);
        marks[symbol] = { price: quote.price, source: quote.source || "mercado" };
      }
    } else if (quote && !quote.executable) {
      events.push({ type: "skipped_stale", symbol, note: quote.status });
    }
    const fund = funding[symbol];
    const hour = Math.floor(now / 3_600_000);
    const position = state.positions.find((item) => item.symbol === symbol);
    if (position && fund?.fresh && fundingHour !== hour && quote?.price) {
      const missed = fundingHour == null ? 0 : hour - fundingHour - 1;
      if (missed > 0) {
        note = `No se aplicó funding de ${missed} hora(s) sin tasa histórica.`;
        events.push({ type: "data_gap", symbol, note });
      }
      const applied = applyFunding(state, { symbol, rate: fund.rate, mark: quote.price, now });
      if (applied.ok) {
        state = applied.state;
        events.push(...applied.events);
        fundedThisRun = true;
      }
    }
  }
  if (fundedThisRun) fundingHour = Math.floor(now / 3_600_000);

  if (events.length || Object.keys(marks).length) {
    await persist(db, loaded.account, loaded.snap, state, events, marks, now);
  }
  await db.query("update accounts set last_processed_at = $1, last_funding_hour = $2, catchup_note = $3 where id = $4", [
    now,
    fundingHour,
    note,
    accountId,
  ]);
  const equity = accountEquity(state, Object.fromEntries(Object.entries(marks).map(([symbol, mark]) => [symbol, mark.price])));
  const bucket = now - (now % (5 * 60_000));
  await db.query(
    `insert into equity_snapshots (account_id, ts, equity, balance) values ($1,$2,$3,$4)
     on conflict (account_id, ts) do update set equity = excluded.equity, balance = excluded.balance`,
    [accountId, bucket, equity, state.balance],
  );
  return { state, events, note };
}

export async function accountView(db: Db, accountId: string, quotes: QuoteView[]) {
  const { account, snap } = await loadSnap(db, accountId);
  const marks: Record<string, string> = {};
  const positions = snap.positions.map((position) => {
    const quote = quotes.find((item) => item.symbol === position.symbol);
    const mark = quote?.price;
    if (mark && quote?.executable) marks[position.symbol] = mark;
    return {
      ...position,
      mark: mark ?? null,
      markStatus: quote?.status ?? "unavailable",
      markSource: quote?.source ?? null,
      upnl: mark ? unrealizedPnl(position, mark) : null,
      roe: mark ? roe(position, mark) : null,
      liquidation: liquidationPrice(position.side, position.entryPrice, position.leverage),
    };
  });
  const closed = await db.query(
    "select * from trades where account_id = $1 order by closed_at desc limit 200",
    [accountId],
  );
  const wins = closed.filter((row) => Number(row.realized_pnl) - Number(row.fee) > 0).length;
  const equity = accountEquity(snap, marks);
  return {
    id: account.id,
    label: account.label,
    initialBalance: account.initial_balance,
    balance: snap.balance,
    equity,
    isDemo: false,
    catchupNote: account.catchup_note,
    lastProcessedAt: num(account.last_processed_at),
    positions,
    orders: snap.orders,
    stats: {
      trades: closed.length,
      winRate: closed.length ? wins / closed.length : null,
      best: closed.reduce<number | null>((best, row) => {
        const net = Number(row.realized_pnl) - Number(row.fee);
        return best === null ? net : Math.max(best, net);
      }, null),
      worst: closed.reduce<number | null>((worst, row) => {
        const net = Number(row.realized_pnl) - Number(row.fee);
        return worst === null ? net : Math.min(worst, net);
      }, null),
    },
  };
}

export async function tradeHistory(db: Db, accountId: string, filters: { symbol?: string; side?: string; reason?: string }) {
  const rows = await db.query<Record<string, unknown>>(
    "select * from trades where account_id = $1 order by closed_at desc limit 500",
    [accountId],
  );
  return rows.filter((row) => {
    if (filters.symbol && row.symbol !== filters.symbol) return false;
    if (filters.side && row.side !== filters.side) return false;
    if (filters.reason && row.reason !== filters.reason) return false;
    return true;
  });
}
