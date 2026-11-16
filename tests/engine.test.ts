import { describe, expect, it } from "vitest";
import { baselineDecision } from "../src/engine/baseline";
import { resolveBattle, scorePrediction } from "../src/engine/battle";
import { computeIndicators } from "../src/engine/indicators";
import { d } from "../src/engine/money";
import { compositeScore, maxDrawdown } from "../src/engine/rank";
import {
  accountEquity,
  applyFunding,
  cancelOrder,
  closeMarket,
  liquidationPrice,
  openMarket,
  placePending,
  resetBalances,
  roe,
  setProtection,
  stepOnCandle,
  stepOnPrice,
  unrealizedPnl,
  type AccountSnap,
  type WorkingOrder,
} from "../src/engine/trading";

function snap(balance = "100"): AccountSnap {
  return { balance, positions: [], orders: [] };
}

describe("motor de paper trading", () => {
  it("abre un largo, calcula PnL y cierra con comisiones", () => {
    const opened = openMarket(snap("100"), {
      id: "p1",
      symbol: "BTC",
      side: "long",
      margin: "10",
      leverage: 10,
      price: "100",
      now: 1,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.state.balance).toBe("89.95000000");
    expect(opened.value.qty).toBe("1.00000000");
    expect(opened.value.fees).toBe("0.05000000");
    expect(unrealizedPnl(opened.value, "110")).toBe("10.00000000");
    expect(roe(opened.value, "110")).toBe("1.00000000");
    expect(accountEquity(opened.state, { BTC: "110" })).toBe("109.95000000");

    const closed = closeMarket(opened.state, { positionId: "p1", price: "110", now: 2, reason: "market" });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.state.positions).toHaveLength(0);
    expect(closed.state.balance).toBe("109.89500000");
    expect(closed.events[0]?.type).toBe("close");
  });

  it("abre un corto y gana si el precio baja", () => {
    const opened = openMarket(snap(), {
      id: "s1",
      symbol: "ETH",
      side: "short",
      margin: "20",
      leverage: 5,
      price: "200",
      now: 1,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(unrealizedPnl(opened.value, "180")).toBe("10.00000000");
    const closed = closeMarket(opened.state, { positionId: "s1", price: "180", now: 2, reason: "market" });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(d(closed.state.balance).gt(100)).toBe(true);
  });

  it("rechaza saldo insuficiente y no muta el estado", () => {
    const state = snap("10");
    const opened = openMarket(state, {
      id: "x",
      symbol: "BTC",
      side: "long",
      margin: "10",
      leverage: 2,
      price: "100",
      now: 1,
    });
    expect(opened.ok).toBe(false);
    expect(state.balance).toBe("10");
    expect(state.positions).toHaveLength(0);
  });

  it("cierra parcialmente y conserva el resto", () => {
    const opened = openMarket(snap(), {
      id: "p1",
      symbol: "BTC",
      side: "long",
      margin: "10",
      leverage: 2,
      price: "100",
      now: 1,
    });
    if (!opened.ok) throw new Error("open");
    const closed = closeMarket(opened.state, { positionId: "p1", qty: "0.1", price: "110", now: 2, reason: "market" });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.events[0]?.type).toBe("partial_close");
    expect(closed.state.positions).toHaveLength(1);
    expect(closed.state.positions[0]?.qty).toBe("0.10000000");
  });

  it("calcula precios de liquidación", () => {
    expect(liquidationPrice("long", "100", 10)).toBe("90.50000000");
    expect(liquidationPrice("short", "100", 10)).toBe("109.50000000");
  });

  it("ejecuta take profit y stop loss", () => {
    const opened = openMarket(snap(), {
      id: "p1",
      symbol: "BTC",
      side: "long",
      margin: "10",
      leverage: 5,
      price: "100",
      now: 1,
    });
    if (!opened.ok) throw new Error("open");
    const armed = setProtection(opened.state, { positionId: "p1", tp: "110", sl: "96", mark: "100" });
    expect(armed.ok).toBe(true);
    if (!armed.ok) return;
    const tp = stepOnPrice(armed.state, { symbol: "BTC", price: "111", now: 2, executable: true });
    expect(tp.ok).toBe(true);
    if (!tp.ok) return;
    expect(tp.events.some((e) => e.reason === "take_profit")).toBe(true);
    expect(tp.state.positions).toHaveLength(0);

    const armed2 = setProtection(opened.state, { positionId: "p1", tp: "110", sl: "96", mark: "100" });
    if (!armed2.ok) throw new Error("arm");
    const sl = stepOnPrice(armed2.state, { symbol: "BTC", price: "95", now: 3, executable: true });
    expect(sl.ok).toBe(true);
    if (!sl.ok) return;
    expect(sl.events.some((e) => e.reason === "stop_loss")).toBe(true);
  });

  it("no liquida con un precio por debajo del stop si el stop está definido", () => {
    const opened = openMarket(snap(), {
      id: "p1",
      symbol: "BTC",
      side: "long",
      margin: "10",
      leverage: 10,
      price: "100",
      now: 1,
    });
    if (!opened.ok) throw new Error("open");
    const armed = setProtection(opened.state, { positionId: "p1", sl: "95", mark: "100" });
    if (!armed.ok) throw new Error(armed.error);
    const stepped = stepOnPrice(armed.state, { symbol: "BTC", price: "80", now: 2, executable: true });
    expect(stepped.ok).toBe(true);
    if (!stepped.ok) return;
    expect(stepped.events.some((e) => e.type === "liquidation")).toBe(false);
    expect(stepped.events.some((e) => e.reason === "stop_loss")).toBe(true);
  });

  it("liquida un largo cuando el precio cruza la liquidación", () => {
    const opened = openMarket(snap(), {
      id: "p1",
      symbol: "BTC",
      side: "long",
      margin: "10",
      leverage: 10,
      price: "100",
      now: 1,
    });
    if (!opened.ok) throw new Error("open");
    const stepped = stepOnPrice(opened.state, { symbol: "BTC", price: "90", now: 2, executable: true });
    expect(stepped.ok).toBe(true);
    if (!stepped.ok) return;
    expect(stepped.state.positions).toHaveLength(0);
    expect(stepped.events.some((e) => e.type === "liquidation")).toBe(true);
    expect(stepped.state.balance).toBe(opened.state.balance);
  });

  it("no ejecuta ni liquida si el precio no es ejecutable", () => {
    const opened = openMarket(snap(), {
      id: "p1",
      symbol: "BTC",
      side: "long",
      margin: "10",
      leverage: 20,
      price: "100",
      now: 1,
    });
    if (!opened.ok) throw new Error("open");
    const stepped = stepOnPrice(opened.state, { symbol: "BTC", price: "1", now: 2, executable: false });
    expect(stepped.ok).toBe(true);
    if (!stepped.ok) return;
    expect(stepped.state.positions).toHaveLength(1);
    expect(stepped.events[0]?.type).toBe("skipped_stale");
  });

  it("marca una vela ambigua y no liquida", () => {
    const opened = openMarket(snap(), {
      id: "p1",
      symbol: "BTC",
      side: "long",
      margin: "10",
      leverage: 5,
      price: "100",
      now: 1,
    });
    if (!opened.ok) throw new Error("open");
    const armed = setProtection(opened.state, { positionId: "p1", tp: "110", sl: "96", mark: "100" });
    if (!armed.ok) throw new Error("arm");
    const stepped = stepOnCandle(armed.state, {
      symbol: "BTC",
      now: 2,
      candle: { open: "100", high: "112", low: "94", close: "101", ts: 2 },
    });
    expect(stepped.ambiguous).toBe(true);
    expect(stepped.state.positions).toHaveLength(1);
  });

  it("en una vela solo a la baja ejecuta el stop y no la liquidación", () => {
    const opened = openMarket(snap(), {
      id: "p1",
      symbol: "BTC",
      side: "long",
      margin: "10",
      leverage: 10,
      price: "100",
      now: 1,
    });
    if (!opened.ok) throw new Error("open");
    const armed = setProtection(opened.state, { positionId: "p1", sl: "95", mark: "100" });
    if (!armed.ok) throw new Error(armed.error);
    const stepped = stepOnCandle(armed.state, {
      symbol: "BTC",
      now: 2,
      candle: { open: "100", high: "101", low: "89", close: "90", ts: 2 },
    });
    expect(stepped.ambiguous).toBeUndefined();
    expect(stepped.state.positions).toHaveLength(0);
    expect(stepped.events.some((e) => e.reason === "stop_loss")).toBe(true);
    expect(stepped.events.some((e) => e.type === "liquidation")).toBe(false);
  });

  it("coloca, no ejecuta y cancela una limit", () => {
    const order: WorkingOrder = {
      id: "o1",
      symbol: "BTC",
      side: "long",
      intent: "open",
      type: "limit",
      margin: "10",
      leverage: 2,
      qty: null,
      limitPrice: "90",
      stopPrice: null,
      positionId: null,
      createdAt: 1,
    };
    const placed = placePending(snap(), order);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const idle = stepOnPrice(placed.state, { symbol: "BTC", price: "100", now: 2, executable: true });
    expect(idle.ok && idle.state.orders).toHaveLength(1);
    const cancelled = cancelOrder(placed.state, "o1");
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.state.orders).toHaveLength(0);
    expect(cancelled.state.balance).toBe("100");
  });

  it("ejecuta una orden límite cuando el precio la toca", () => {
    const placed = placePending(snap(), {
      id: "o1",
      symbol: "BTC",
      side: "long",
      intent: "open",
      type: "limit",
      margin: "10",
      leverage: 2,
      qty: null,
      limitPrice: "90",
      stopPrice: null,
      positionId: null,
      createdAt: 1,
    });
    if (!placed.ok) throw new Error("place");
    const filled = stepOnPrice(placed.state, { symbol: "BTC", price: "89", now: 2, executable: true });
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(filled.state.orders).toHaveLength(0);
    expect(filled.state.positions).toHaveLength(1);
    expect(filled.state.positions[0]?.entryPrice).toBe("90.00000000");
  });

  it("aplica funding: el largo paga y el corto cobra", () => {
    const opened = openMarket(snap(), {
      id: "p1",
      symbol: "BTC",
      side: "long",
      margin: "10",
      leverage: 2,
      price: "100",
      now: 1,
    });
    if (!opened.ok) throw new Error("open");
    const funded = applyFunding(opened.state, { symbol: "BTC", rate: "0.001", mark: "100", now: 2 });
    expect(funded.ok).toBe(true);
    if (!funded.ok) return;
    expect(d(funded.state.balance).lt(opened.state.balance)).toBe(true);
    expect(d(funded.state.positions[0]?.funding ?? "0").lt(0)).toBe(true);

    const short = openMarket(snap(), {
      id: "s1",
      symbol: "BTC",
      side: "short",
      margin: "10",
      leverage: 2,
      price: "100",
      now: 1,
    });
    if (!short.ok) throw new Error("short");
    const received = applyFunding(short.state, { symbol: "BTC", rate: "0.001", mark: "100", now: 2 });
    expect(received.ok).toBe(true);
    if (!received.ok) return;
    expect(d(received.state.balance).gt(short.state.balance)).toBe(true);
  });

  it("el margen aislado no deja el saldo libre en negativo al cerrar con hueco", () => {
    const opened = openMarket(snap(), {
      id: "p1",
      symbol: "BTC",
      side: "long",
      margin: "10",
      leverage: 2,
      price: "100",
      now: 1,
    });
    if (!opened.ok) throw new Error("open");
    const closed = closeMarket(opened.state, { positionId: "p1", price: "1", now: 2, reason: "market" });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(d(closed.state.balance).gte(0)).toBe(true);
    expect(d(closed.state.balance).lt(opened.state.balance)).toBe(true);
  });

  it("rechaza un stop más allá de la liquidación", () => {
    const opened = openMarket(snap(), {
      id: "p1",
      symbol: "BTC",
      side: "long",
      margin: "10",
      leverage: 10,
      price: "100",
      now: 1,
    });
    if (!opened.ok) throw new Error("open");
    const armed = setProtection(opened.state, { positionId: "p1", sl: "90", mark: "100" });
    expect(armed.ok).toBe(false);
  });

  it("reinicia solo si no hay posiciones", () => {
    const blocked = resetBalances(
      {
        balance: "50",
        positions: [
          {
            id: "p",
            symbol: "BTC",
            side: "long",
            qty: "1",
            entryPrice: "100",
            margin: "10",
            leverage: 2,
            realizedPnl: "0",
            fees: "0",
            funding: "0",
            openedAt: 1,
            tp: null,
            sl: null,
          },
        ],
        orders: [],
      },
      "100",
    );
    expect(blocked.ok).toBe(false);
    const reset = resetBalances(snap("40"), "100");
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect(reset.state.balance).toBe("100.00000000");
  });
});

describe("indicadores", () => {
  it("el RSI sube en una serie alcista y baja en una bajista", () => {
    const up = Array.from({ length: 40 }, (_, i) => ({
      ts: i,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100 + i,
      volume: 10,
    }));
    const down = up.map((bar, i) => ({ ...bar, open: 140 - i, high: 141 - i, low: 139 - i, close: 140 - i }));
    const upRsi = computeIndicators(up).at(-1)?.rsi14 ?? 0;
    const downRsi = computeIndicators(down).at(-1)?.rsi14 ?? 100;
    expect(upRsi).toBeGreaterThan(70);
    expect(downRsi).toBeLessThan(30);
  });

  it("la EMA rápida queda por encima en una tendencia alcista", () => {
    const bars = Array.from({ length: 80 }, (_, i) => ({
      ts: i,
      open: 50 + i * 0.4,
      high: 51 + i * 0.4,
      low: 49 + i * 0.4,
      close: 50 + i * 0.4,
      volume: 5 + (i % 3),
    }));
    const last = computeIndicators(bars).at(-1);
    expect(last?.ema20).not.toBeNull();
    expect(last?.ema50).not.toBeNull();
    expect(last!.ema20!).toBeGreaterThan(last!.ema50!);
    expect(last?.bbUpper).toBeGreaterThan(last?.bbLower ?? 0);
    expect(last?.atr14).toBeGreaterThan(0);
    expect(last?.vwap).toBeGreaterThan(0);
  });
});

describe("market battle", () => {
  it("resuelve por barrera y puntúa el acierto", () => {
    const resolution = resolveBattle({
      startPrice: "100",
      rewardPct: "1.5",
      riskPct: "1",
      startAt: 0,
      endAt: 10_000,
      candles: [
        { ts: 1000, high: "100.4", low: "99.8", close: "100.2" },
        { ts: 2000, high: "101.6", low: "100.1", close: "101.5" },
      ],
    });
    expect(resolution.kind).toBe("barrier_up");
    const score = scorePrediction({
      direction: "up",
      resolution: resolution.kind,
      rewardPct: "1.5",
      riskPct: "1",
      startedAt: 0,
      resolvedAt: resolution.resolvedAt,
      endsAt: 10_000,
    });
    expect(score.correct).toBe(true);
    expect(score.points).toBeGreaterThan(100);
    const wrong = scorePrediction({
      direction: "down",
      resolution: resolution.kind,
      rewardPct: "1.5",
      riskPct: "1",
      startedAt: 0,
      resolvedAt: resolution.resolvedAt,
      endsAt: 10_000,
    });
    expect(wrong.correct).toBe(false);
    expect(wrong.points).toBe(-40);
  });

  it("no inventa el ganador si una vela toca las dos barreras", () => {
    const resolution = resolveBattle({
      startPrice: "100",
      rewardPct: "1",
      riskPct: "1",
      startAt: 0,
      endAt: 5000,
      candles: [{ ts: 1000, high: "102", low: "98", close: "100" }],
    });
    expect(resolution.kind).toBe("unverifiable");
    const score = scorePrediction({
      direction: "up",
      resolution: "unverifiable",
      rewardPct: "1",
      riskPct: "1",
      startedAt: 0,
      resolvedAt: 1000,
      endsAt: 5000,
    });
    expect(score.correct).toBeNull();
    expect(score.points).toBe(10);
  });
});

describe("ranking y baseline", () => {
  it("no declara ganador con menos de 3 operaciones", () => {
    expect(compositeScore({ returnPct: 0.5, winRate: 1, closedTrades: 2, maxDrawdownPct: 0.1 }).score).toBeNull();
    const scored = compositeScore({ returnPct: 0.1, winRate: 0.6, closedTrades: 4, maxDrawdownPct: 0.05 });
    expect(scored.score).not.toBeNull();
  });

  it("calcula el drawdown máximo", () => {
    expect(maxDrawdown([100, 120, 90, 110])).toBeCloseTo(0.25);
  });

  it("la regla baseline abre largo solo con cruce alcista", () => {
    const decision = baselineDecision({
      ema20: 105,
      ema50: 100,
      rsi14: 55,
      atr14: 2,
      price: 106,
      hasLong: false,
      hasShort: false,
    });
    expect(decision.action).toBe("open_long");
    expect(decision.confidence).toBeNull();
    const hold = baselineDecision({
      ema20: null,
      ema50: null,
      rsi14: null,
      atr14: null,
      price: 10,
      hasLong: false,
      hasShort: false,
    });
    expect(hold.action).toBe("hold");
  });
});
