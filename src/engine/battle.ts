import { d, q } from "./money";

export type Direction = "up" | "down";
export type ResolutionKind =
  | "barrier_up"
  | "barrier_down"
  | "close_up"
  | "close_down"
  | "flat"
  | "unverifiable";

export interface BattleCandle {
  ts: number;
  high: string;
  low: string;
  close: string;
}

export interface Resolution {
  kind: ResolutionKind;
  resolvedAt: number;
  endPrice: string | null;
  high: string | null;
  low: string | null;
  note: string;
}

export function barriers(startPrice: string, rewardPct: string, riskPct: string): { up: string; down: string } {
  const start = d(startPrice);
  return {
    up: q(start.times(d(1).plus(d(rewardPct).div(100)))),
    down: q(start.times(d(1).minus(d(riskPct).div(100)))),
  };
}

export function resolveBattle(input: {
  startPrice: string;
  rewardPct: string;
  riskPct: string;
  candles: BattleCandle[];
  startAt: number;
  endAt: number;
}): Resolution {
  const { up, down } = barriers(input.startPrice, input.rewardPct, input.riskPct);
  let high: string | null = null;
  let low: string | null = null;
  const ordered = [...input.candles].filter((c) => c.ts >= input.startAt && c.ts < input.endAt).sort((a, b) => a.ts - b.ts);
  for (const candle of ordered) {
    high = high === null || d(candle.high).gt(high) ? candle.high : high;
    low = low === null || d(candle.low).lt(low) ? candle.low : low;
    const hitUp = d(candle.high).gte(up);
    const hitDown = d(candle.low).lte(down);
    if (hitUp && hitDown) {
      return {
        kind: "unverifiable",
        resolvedAt: candle.ts,
        endPrice: candle.close,
        high,
        low,
        note: "La misma vela toca el objetivo al alza y el stop a la baja. No se inventa el orden.",
      };
    }
    if (hitUp) {
      return { kind: "barrier_up", resolvedAt: candle.ts, endPrice: up, high, low, note: "El precio tocó la barrera superior." };
    }
    if (hitDown) {
      return { kind: "barrier_down", resolvedAt: candle.ts, endPrice: down, high, low, note: "El precio tocó la barrera inferior." };
    }
  }
  const last = ordered[ordered.length - 1];
  if (!last) {
    return {
      kind: "unverifiable",
      resolvedAt: input.endAt,
      endPrice: null,
      high,
      low,
      note: "No hay velas reales en la ventana de la ronda.",
    };
  }
  if (d(last.close).gt(input.startPrice)) {
    return { kind: "close_up", resolvedAt: input.endAt, endPrice: last.close, high, low, note: "Ninguna barrera se tocó. El cierre queda por encima del inicio." };
  }
  if (d(last.close).lt(input.startPrice)) {
    return { kind: "close_down", resolvedAt: input.endAt, endPrice: last.close, high, low, note: "Ninguna barrera se tocó. El cierre queda por debajo del inicio." };
  }
  return { kind: "flat", resolvedAt: input.endAt, endPrice: last.close, high, low, note: "El cierre coincide con el precio inicial." };
}

export function scorePrediction(input: {
  direction: Direction;
  resolution: ResolutionKind;
  rewardPct: string;
  riskPct: string;
  startedAt: number;
  resolvedAt: number;
  endsAt: number;
}): { points: number; correct: boolean | null; reason: string; formula: string } {
  const reward = d(input.rewardPct);
  const risk = d(input.riskPct);
  const rr = risk.eq(0) ? d(1) : reward.div(risk);
  const participation = 10;
  if (input.resolution === "unverifiable" || input.resolution === "flat") {
    return {
      points: participation,
      correct: null,
      reason: input.resolution === "flat" ? "cierre_plano" : "no_verificable",
      formula: "puntos = 10 de participación; sin acierto ni fallo porque el resultado no es dirimible",
    };
  }
  const up = input.resolution === "barrier_up" || input.resolution === "close_up";
  const correct = up ? input.direction === "up" : input.direction === "down";
  if (!correct) {
    return {
      points: -40,
      correct: false,
      reason: "fallo",
      formula: "puntos = -40",
    };
  }
  if (input.resolution === "close_up" || input.resolution === "close_down") {
    return {
      points: 50,
      correct: true,
      reason: "acierto_por_cierre",
      formula: "puntos = 40 de acierto por cierre + 10 de participación",
    };
  }
  const span = Math.max(1, input.endsAt - input.startedAt);
  const speed = Math.min(1, Math.max(0, 1 - (input.resolvedAt - input.startedAt) / span));
  const points = Math.round(100 * rr.toNumber() + 20 * speed + participation);
  return {
    points,
    correct: true,
    reason: "acierto_por_barrera",
    formula: `puntos = redondeo(100 * (${input.rewardPct}/${input.riskPct}) + 20 * ${speed.toFixed(4)} + 10)`,
  };
}
