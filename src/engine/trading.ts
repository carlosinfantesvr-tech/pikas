import {
  MAINTENANCE_MARGIN_RATE,
  MAKER_FEE,
  TAKER_FEE,
  add,
  d,
  div,
  eq,
  gt,
  gte,
  isPositive,
  lt,
  lte,
  mul,
  q,
  sub,
} from "./money";

export type Side = "long" | "short";
export type OrderType = "market" | "limit" | "stop_market";
export type CloseReason =
  | "market"
  | "take_profit"
  | "stop_loss"
  | "liquidation"
  | "stop_order"
  | "limit"
  | "reset";

export interface Position {
  id: string;
  symbol: string;
  side: Side;
  qty: string;
  entryPrice: string;
  margin: string;
  leverage: number;
  realizedPnl: string;
  fees: string;
  funding: string;
  openedAt: number;
  tp: string | null;
  sl: string | null;
}

export interface WorkingOrder {
  id: string;
  symbol: string;
  side: Side;
  intent: "open" | "close";
  type: "limit" | "stop_market";
  margin: string | null;
  leverage: number | null;
  qty: string | null;
  limitPrice: string | null;
  stopPrice: string | null;
  positionId: string | null;
  createdAt: number;
}

export interface AccountSnap {
  balance: string;
  positions: Position[];
  orders: WorkingOrder[];
}

export interface EngineEvent {
  type: string;
  symbol?: string;
  positionId?: string;
  orderId?: string;
  amount?: string;
  price?: string;
  fee?: string;
  note?: string;
  reason?: string;
}

export type EngineResult<T = undefined> =
  | { ok: true; state: AccountSnap; events: EngineEvent[]; value: T }
  | { ok: false; state: AccountSnap; error: string; code: string };

export interface Candle {
  open: string;
  high: string;
  low: string;
  close: string;
  ts: number;
}

function clone(state: AccountSnap): AccountSnap {
  return {
    balance: state.balance,
    positions: state.positions.map((p) => ({ ...p })),
    orders: state.orders.map((o) => ({ ...o })),
  };
}

function fail(state: AccountSnap, error: string, code: string): EngineResult<never> {
  return { ok: false, state, error, code };
}

export function liquidationPrice(side: Side, entry: string, leverage: number): string {
  const e = d(entry);
  const L = d(leverage);
  const mmr = d(MAINTENANCE_MARGIN_RATE);
  if (side === "long") {
    return q(e.times(d(1).minus(d(1).div(L)).plus(mmr)));
  }
  return q(e.times(d(1).plus(d(1).div(L)).minus(mmr)));
}

export function unrealizedPnl(position: Position, mark: string): string {
  const diff = d(mark).minus(position.entryPrice);
  const signed = position.side === "long" ? diff : diff.neg();
  return q(signed.times(position.qty));
}

export function positionEquity(position: Position, mark: string): string {
  return add(position.margin, unrealizedPnl(position, mark));
}

export function roe(position: Position, mark: string): string {
  if (!isPositive(position.margin)) return q(0);
  return q(d(unrealizedPnl(position, mark)).div(position.margin));
}

export function accountEquity(state: AccountSnap, marks: Record<string, string>): string {
  let equity = d(state.balance);
  for (const position of state.positions) {
    const mark = marks[position.symbol];
    equity = equity.plus(position.margin);
    if (mark) equity = equity.plus(unrealizedPnl(position, mark));
  }
  return q(equity);
}

function feeFor(notional: string, rate: string): string {
  return q(d(notional).times(rate));
}

function findPosition(state: AccountSnap, symbol: string): Position | undefined {
  return state.positions.find((p) => p.symbol === symbol);
}

export function openMarket(
  input: AccountSnap,
  cmd: {
    id: string;
    symbol: string;
    side: Side;
    margin: string;
    leverage: number;
    price: string;
    now: number;
    feeRate?: string;
  },
): EngineResult<Position> {
  const state = clone(input);
  if (!isPositive(cmd.margin)) return fail(state, "El margen debe ser positivo.", "BAD_MARGIN");
  if (!isPositive(cmd.price)) return fail(state, "El precio no es válido.", "BAD_PRICE");
  if (![1, 2, 3, 5, 10, 15, 20].includes(cmd.leverage)) {
    return fail(state, "Apalancamiento no permitido.", "BAD_LEVERAGE");
  }
  if (lt(cmd.margin, "1")) return fail(state, "El margen mínimo es 1 USDT.", "MIN_MARGIN");
  const existing = findPosition(state, cmd.symbol);
  if (existing && existing.side !== cmd.side) {
    return fail(state, "Cierra la posición contraria antes de abrir otra. Modo unidireccional.", "ONE_WAY");
  }
  const notional = mul(cmd.margin, cmd.leverage);
  const rate = cmd.feeRate ?? TAKER_FEE;
  const fee = feeFor(notional, rate);
  const cost = add(cmd.margin, fee);
  if (gt(cost, state.balance)) return fail(state, "Saldo insuficiente para el margen y la comisión.", "INSUFFICIENT");
  const qty = div(notional, cmd.price);
  if (!isPositive(qty)) return fail(state, "El tamaño resultante es cero.", "ZERO_QTY");
  state.balance = sub(state.balance, cost);

  if (existing && existing.side === cmd.side) {
    const newQty = add(existing.qty, qty);
    const newEntry = div(add(mul(existing.entryPrice, existing.qty), mul(cmd.price, qty)), newQty);
    existing.qty = newQty;
    existing.entryPrice = newEntry;
    existing.margin = add(existing.margin, cmd.margin);
    existing.leverage = cmd.leverage;
    existing.fees = add(existing.fees, fee);
    state.orders = state.orders.filter((o) => o.positionId !== existing.id || o.intent !== "close");
    existing.tp = null;
    existing.sl = null;
    return {
      ok: true,
      state,
      value: existing,
      events: [
        {
          type: "open_add",
          symbol: cmd.symbol,
          positionId: existing.id,
          amount: cmd.margin,
          fee,
          price: cmd.price,
        },
      ],
    };
  }

  const position: Position = {
    id: cmd.id,
    symbol: cmd.symbol,
    side: cmd.side,
    qty,
    entryPrice: q(cmd.price),
    margin: q(cmd.margin),
    leverage: cmd.leverage,
    realizedPnl: q(0),
    fees: fee,
    funding: q(0),
    openedAt: cmd.now,
    tp: null,
    sl: null,
  };
  state.positions.push(position);
  return {
    ok: true,
    state,
    value: position,
    events: [{ type: "open", symbol: cmd.symbol, positionId: position.id, amount: q(cmd.margin), fee, price: q(cmd.price) }],
  };
}

export function closeMarket(
  input: AccountSnap,
  cmd: {
    positionId: string;
    qty?: string | null;
    price: string;
    now: number;
    reason: CloseReason;
    feeRate?: string;
  },
): EngineResult<Position> {
  const state = clone(input);
  const index = state.positions.findIndex((p) => p.id === cmd.positionId);
  if (index < 0) return fail(state, "La posición no existe.", "NO_POSITION");
  const position = state.positions[index];
  if (!isPositive(cmd.price)) return fail(state, "El precio no es válido.", "BAD_PRICE");
  let qty = cmd.qty ? q(cmd.qty) : position.qty;
  if (!isPositive(qty)) return fail(state, "La cantidad a cerrar no es válida.", "BAD_QTY");
  if (gt(qty, position.qty)) return fail(state, "No puedes cerrar más de lo que tienes abierto.", "BAD_QTY");
  const remaining = sub(position.qty, qty);
  if (isPositive(remaining) && lt(mul(remaining, cmd.price), "0.5")) qty = position.qty;

  const rate = cmd.feeRate ?? TAKER_FEE;
  const notional = mul(qty, cmd.price);
  const fee = feeFor(notional, rate);
  const diff = d(cmd.price).minus(position.entryPrice);
  let pricePnl = q((position.side === "long" ? diff : diff.neg()).times(qty));
  const released = qty === position.qty ? position.margin : q(d(position.margin).times(d(qty).div(position.qty)));
  // Margen aislado: la pérdida de precio no consume saldo libre más allá del margen liberado.
  if (lt(add(released, pricePnl), "0")) pricePnl = q(d(released).neg());
  state.balance = sub(add(add(state.balance, released), pricePnl), fee);
  position.fees = add(position.fees, fee);
  position.realizedPnl = add(position.realizedPnl, pricePnl);
  position.margin = sub(position.margin, released);
  position.qty = sub(position.qty, qty);

  const full = !isPositive(position.qty);
  if (full) {
    state.positions.splice(index, 1);
    state.orders = state.orders.filter((o) => o.positionId !== position.id);
  }
  return {
    ok: true,
    state,
    value: position,
    events: [
      {
        type: full ? "close" : "partial_close",
        symbol: position.symbol,
        positionId: position.id,
        amount: pricePnl,
        fee,
        price: q(cmd.price),
        reason: cmd.reason,
        note: qty,
      },
    ],
  };
}

function forfeit(state: AccountSnap, position: Position, price: string, now: number): EngineEvent {
  const index = state.positions.findIndex((p) => p.id === position.id);
  if (index >= 0) state.positions.splice(index, 1);
  state.orders = state.orders.filter((o) => o.positionId !== position.id);
  position.realizedPnl = q(d(position.realizedPnl).minus(position.margin));
  position.margin = q(0);
  position.qty = q(0);
  return {
    type: "liquidation",
    symbol: position.symbol,
    positionId: position.id,
    price: q(price),
    amount: position.realizedPnl,
    note: `liquidación simulada ${now}`,
    reason: "liquidation",
  };
}

export function setProtection(
  input: AccountSnap,
  cmd: { positionId: string; tp?: string | null; sl?: string | null; mark: string },
): EngineResult<Position> {
  const state = clone(input);
  const position = state.positions.find((p) => p.id === cmd.positionId);
  if (!position) return fail(state, "La posición no existe.", "NO_POSITION");
  const liq = liquidationPrice(position.side, position.entryPrice, position.leverage);
  const tp = cmd.tp === undefined ? position.tp : cmd.tp;
  const sl = cmd.sl === undefined ? position.sl : cmd.sl;
  if (tp) {
    if (!isPositive(tp)) return fail(state, "El take profit no es válido.", "BAD_TP");
    if (position.side === "long" && lte(tp, cmd.mark)) return fail(state, "El take profit de un largo debe estar por encima del precio.", "BAD_TP");
    if (position.side === "short" && gte(tp, cmd.mark)) return fail(state, "El take profit de un corto debe estar por debajo del precio.", "BAD_TP");
  }
  if (sl) {
    if (!isPositive(sl)) return fail(state, "El stop loss no es válido.", "BAD_SL");
    if (position.side === "long") {
      if (gte(sl, cmd.mark)) return fail(state, "El stop loss de un largo debe estar por debajo del precio.", "BAD_SL");
      if (lte(sl, liq)) return fail(state, "Ese stop está en o más allá de la liquidación. Ajústalo.", "SL_BEYOND_LIQ");
    } else {
      if (lte(sl, cmd.mark)) return fail(state, "El stop loss de un corto debe estar por encima del precio.", "BAD_SL");
      if (gte(sl, liq)) return fail(state, "Ese stop está en o más allá de la liquidación. Ajústalo.", "SL_BEYOND_LIQ");
    }
  }
  position.tp = tp ? q(tp) : null;
  position.sl = sl ? q(sl) : null;
  return {
    ok: true,
    state,
    value: position,
    events: [{ type: "protection", positionId: position.id, symbol: position.symbol, note: `tp=${position.tp ?? "-"} sl=${position.sl ?? "-"}` }],
  };
}

export function placePending(
  input: AccountSnap,
  order: WorkingOrder,
): EngineResult<WorkingOrder> {
  const state = clone(input);
  if (order.intent === "open") {
    if (!order.margin || !order.leverage) return fail(state, "Faltan margen o apalancamiento.", "BAD_ORDER");
    if (lt(order.margin, "1")) return fail(state, "El margen mínimo es 1 USDT.", "MIN_MARGIN");
    if (![1, 2, 3, 5, 10, 15, 20].includes(order.leverage)) return fail(state, "Apalancamiento no permitido.", "BAD_LEVERAGE");
    const fee = feeFor(mul(order.margin, order.leverage), MAKER_FEE);
    if (gt(add(order.margin, fee), state.balance)) return fail(state, "Saldo insuficiente para esta orden.", "INSUFFICIENT");
    const price = order.type === "limit" ? order.limitPrice : order.stopPrice;
    if (!price || !isPositive(price)) return fail(state, "Precio de la orden no válido.", "BAD_PRICE");
  } else {
    const position = state.positions.find((p) => p.id === order.positionId);
    if (!position) return fail(state, "No hay posición para reducir.", "NO_POSITION");
    if (!order.qty || !isPositive(order.qty) || gt(order.qty, position.qty)) {
      return fail(state, "Cantidad de cierre no válida.", "BAD_QTY");
    }
  }
  state.orders.push({ ...order });
  return { ok: true, state, value: order, events: [{ type: "order_accepted", orderId: order.id, symbol: order.symbol }] };
}

export function cancelOrder(input: AccountSnap, orderId: string): EngineResult {
  const state = clone(input);
  const before = state.orders.length;
  state.orders = state.orders.filter((o) => o.id !== orderId);
  if (state.orders.length === before) return fail(state, "La orden no existe.", "NO_ORDER");
  return { ok: true, state, value: undefined, events: [{ type: "order_cancelled", orderId }] };
}

export function applyFunding(
  input: AccountSnap,
  cmd: { symbol: string; rate: string; mark: string; now: number },
): EngineResult {
  const state = clone(input);
  const position = state.positions.find((p) => p.symbol === cmd.symbol);
  if (!position) return { ok: true, state, value: undefined, events: [] };
  if (!isPositive(cmd.mark)) return fail(state, "Precio de funding no válido.", "BAD_PRICE");
  const notional = mul(position.qty, cmd.mark);
  const payment = q(d(notional).times(cmd.rate));
  const cashflow = position.side === "long" ? q(d(payment).neg()) : payment;
  position.funding = add(position.funding, cashflow);
  if (gte(cashflow, 0)) {
    state.balance = add(state.balance, cashflow);
  } else {
    const due = q(d(cashflow).abs());
    if (gte(state.balance, due)) {
      state.balance = sub(state.balance, due);
    } else {
      const rest = sub(due, state.balance);
      state.balance = q(0);
      if (gt(rest, position.margin)) {
        const event = forfeit(state, position, cmd.mark, cmd.now);
        return { ok: true, state, value: undefined, events: [event, { type: "funding", symbol: cmd.symbol, amount: cashflow, note: "margen agotado" }] };
      }
      position.margin = sub(position.margin, rest);
    }
  }
  return {
    ok: true,
    state,
    value: undefined,
    events: [{ type: "funding", symbol: cmd.symbol, positionId: position.id, amount: cashflow, price: q(cmd.mark) }],
  };
}

interface Trigger {
  kind: "tp" | "sl" | "liq" | "limit" | "stop";
  price: string;
  orderId?: string;
  positionId?: string;
}

function triggersFor(state: AccountSnap, symbol: string): Trigger[] {
  const out: Trigger[] = [];
  const position = findPosition(state, symbol);
  if (position) {
    out.push({ kind: "liq", price: liquidationPrice(position.side, position.entryPrice, position.leverage), positionId: position.id });
    if (position.tp) out.push({ kind: "tp", price: position.tp, positionId: position.id });
    if (position.sl) out.push({ kind: "sl", price: position.sl, positionId: position.id });
  }
  for (const order of state.orders) {
    if (order.symbol !== symbol) continue;
    if (order.type === "limit" && order.limitPrice) out.push({ kind: "limit", price: order.limitPrice, orderId: order.id });
    if (order.type === "stop_market" && order.stopPrice) out.push({ kind: "stop", price: order.stopPrice, orderId: order.id });
  }
  return out;
}

function executeTrigger(state: AccountSnap, trigger: Trigger, price: string, now: number, symbol: string): EngineResult {
  if (trigger.kind === "liq" && trigger.positionId) {
    const position = state.positions.find((p) => p.id === trigger.positionId);
    if (!position) return { ok: true, state, value: undefined, events: [] };
    const event = forfeit(state, position, price, now);
    return { ok: true, state, value: undefined, events: [event] };
  }
  if ((trigger.kind === "tp" || trigger.kind === "sl") && trigger.positionId) {
    const closed = closeMarket(state, {
      positionId: trigger.positionId,
      price,
      now,
      reason: trigger.kind === "tp" ? "take_profit" : "stop_loss",
    });
    if (!closed.ok) return closed;
    return { ok: true, state: closed.state, value: undefined, events: closed.events };
  }
  const order = state.orders.find((o) => o.id === trigger.orderId);
  if (!order) return { ok: true, state, value: undefined, events: [] };
  state.orders = state.orders.filter((o) => o.id !== order.id);
  if (order.intent === "open" && order.margin && order.leverage) {
    const opened = openMarket(state, {
      id: `${order.id}-fill`,
      symbol,
      side: order.side,
      margin: order.margin,
      leverage: order.leverage,
      price,
      now,
      feeRate: order.type === "limit" ? MAKER_FEE : TAKER_FEE,
    });
    if (!opened.ok) {
      return {
        ok: true,
        state,
        value: undefined,
        events: [{ type: "order_rejected", orderId: order.id, symbol, note: opened.error }],
      };
    }
    return {
      ok: true,
      state: opened.state,
      value: undefined,
      events: [...opened.events, { type: "order_filled", orderId: order.id, symbol, price: q(price), reason: order.type }],
    };
  }
  if (order.intent === "close" && order.positionId) {
    const closed = closeMarket(state, {
      positionId: order.positionId,
      qty: order.qty,
      price,
      now,
      reason: order.type === "limit" ? "limit" : "stop_order",
      feeRate: order.type === "limit" ? MAKER_FEE : TAKER_FEE,
    });
    if (!closed.ok) return closed;
    return {
      ok: true,
      state: closed.state,
      value: undefined,
      events: [...closed.events, { type: "order_filled", orderId: order.id, price: q(price) }],
    };
  }
  return { ok: true, state, value: undefined, events: [] };
}

function priceHit(kind: Trigger["kind"], side: Side | null, orderSide: Side | null, intent: "open" | "close" | null, level: string, price: string): boolean {
  if (kind === "liq" || kind === "sl") {
    if (side === "long") return lte(price, level);
    if (side === "short") return gte(price, level);
  }
  if (kind === "tp") {
    if (side === "long") return gte(price, level);
    if (side === "short") return lte(price, level);
  }
  if (kind === "limit") {
    if (intent === "open" && orderSide === "long") return lte(price, level);
    if (intent === "open" && orderSide === "short") return gte(price, level);
    if (intent === "close" && orderSide === "long") return gte(price, level);
    if (intent === "close" && orderSide === "short") return lte(price, level);
  }
  if (kind === "stop") {
    if (orderSide === "long") return gte(price, level);
    if (orderSide === "short") return lte(price, level);
  }
  return false;
}

export function stepOnPrice(
  input: AccountSnap,
  cmd: { symbol: string; price: string; now: number; executable: boolean },
): EngineResult {
  const state = clone(input);
  if (!cmd.executable) {
    return { ok: true, state, value: undefined, events: [{ type: "skipped_stale", symbol: cmd.symbol, note: "precio no ejecutable" }] };
  }
  if (!isPositive(cmd.price)) return fail(state, "Precio no válido.", "BAD_PRICE");
  const events: EngineEvent[] = [];
  let guard = 0;
  while (guard++ < 8) {
    const position = findPosition(state, cmd.symbol);
    const triggers = triggersFor(state, cmd.symbol).filter((trigger) => {
      const order = trigger.orderId ? state.orders.find((o) => o.id === trigger.orderId) : undefined;
      const side = position && trigger.positionId === position.id ? position.side : order?.side ?? null;
      return priceHit(trigger.kind, trigger.positionId ? side : null, order?.side ?? side, order?.intent ?? null, trigger.price, cmd.price);
    });
    if (triggers.length === 0) break;
    const sl = triggers.find((t) => t.kind === "sl");
    const liq = triggers.find((t) => t.kind === "liq");
    const tp = triggers.find((t) => t.kind === "tp");
    const chosen = sl ?? tp ?? liq ?? triggers[0];
    const fill = chosen.kind === "limit" || chosen.kind === "tp" || chosen.kind === "sl" ? chosen.price : cmd.price;
    const next = executeTrigger(state, chosen, fill, cmd.now, cmd.symbol);
    if (!next.ok) return next;
    state.balance = next.state.balance;
    state.positions = next.state.positions;
    state.orders = next.state.orders;
    events.push(...next.events);
    if (chosen.kind === "liq" || chosen.kind === "tp" || chosen.kind === "sl") break;
  }
  return { ok: true, state, value: undefined, events };
}

export function stepOnCandle(
  input: AccountSnap,
  cmd: { symbol: string; candle: Candle; now: number },
): EngineResult & { ambiguous?: boolean } {
  const state = clone(input);
  const { candle } = cmd;
  if (!isPositive(candle.high) || !isPositive(candle.low) || gt(candle.low, candle.high)) {
    return fail(state, "Vela no válida.", "BAD_CANDLE");
  }
  const triggers = triggersFor(state, cmd.symbol);
  if (triggers.length === 0) return { ok: true, state, value: undefined, events: [] };

  const position = findPosition(state, cmd.symbol);
  const touched = triggers.filter((trigger) => {
    const level = d(trigger.price);
    return level.gte(candle.low) && level.lte(candle.high);
  });
  if (touched.length === 0) return { ok: true, state, value: undefined, events: [] };

  const open = d(candle.open);
  const above = touched.filter((t) => d(t.price).gt(open));
  const below = touched.filter((t) => d(t.price).lt(open));
  const at = touched.filter((t) => eq(t.price, candle.open));
  if (above.length && below.length) {
    return {
      ok: true,
      state,
      ambiguous: true,
      value: undefined,
      events: [{ type: "ambiguous_candle", symbol: cmd.symbol, note: `vela ${candle.ts} toca niveles en ambos sentidos`, price: candle.open }],
    };
  }
  const side = above.length ? above : below.length ? below : at;
  side.sort((a, b) => d(a.price).minus(open).abs().cmp(d(b.price).minus(open).abs()));
  const chosen = side[0];
  if (side.length > 1) {
    const second = side[1];
    const samePathCouldMatter = chosen.kind === "limit" || chosen.kind === "stop";
    if (samePathCouldMatter && (second.kind === "liq" || second.kind === "tp" || second.kind === "sl")) {
      return {
        ok: true,
        state,
        ambiguous: true,
        value: undefined,
        events: [{ type: "ambiguous_candle", symbol: cmd.symbol, note: "varios disparadores en la misma vela", price: candle.open }],
      };
    }
  }
  const gapped = (above.length === 0 && below.length === 0) ? false : (
    (d(candle.open).gt(candle.high) || d(candle.open).lt(candle.low))
  );
  const fillPrice = gapped ? candle.open : chosen.price;
  const protective = chosen.kind === "tp" || chosen.kind === "sl" || chosen.kind === "liq";
  if (!protective && position && (above.length + below.length + at.length > 1)) {
    // An open order and a protective level on the same side: do not guess the path.
    const hasProtection = side.some((t) => t.kind === "tp" || t.kind === "sl" || t.kind === "liq");
    const hasOrder = side.some((t) => t.kind === "limit" || t.kind === "stop");
    if (hasProtection && hasOrder) {
      return {
        ok: true,
        state,
        ambiguous: true,
        value: undefined,
        events: [{ type: "ambiguous_candle", symbol: cmd.symbol, note: "orden y protección en la misma vela" }],
      };
    }
  }
  const next = executeTrigger(state, chosen, fillPrice, cmd.now, cmd.symbol);
  if (!next.ok) return next;
  return { ...next, events: next.events };
}

export function resetBalances(input: AccountSnap, initial: string): EngineResult {
  const state = clone(input);
  if (state.positions.length || state.orders.length) {
    return fail(state, "Cierra las posiciones y cancela las órdenes antes de reiniciar, con un precio ejecutable.", "RESET_BLOCKED");
  }
  state.balance = q(initial);
  return { ok: true, state, value: undefined, events: [{ type: "reset", amount: q(initial) }] };
}
