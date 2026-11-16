export interface BaselineInput {
  ema20: number | null;
  ema50: number | null;
  rsi14: number | null;
  atr14: number | null;
  price: number;
  hasLong: boolean;
  hasShort: boolean;
}

export type BaselineAction = "hold" | "open_long" | "open_short" | "close";

export interface BaselineDecision {
  action: BaselineAction;
  confidence: number | null;
  risk: "medio";
  tp: number | null;
  sl: number | null;
  rationale: string;
}

/** Reglas públicas. No es un modelo de lenguaje. */
export function baselineDecision(input: BaselineInput): BaselineDecision {
  const { ema20, ema50, rsi14, atr14, price, hasLong, hasShort } = input;
  if (ema20 === null || ema50 === null || rsi14 === null || !Number.isFinite(price)) {
    return {
      action: "hold",
      confidence: null,
      risk: "medio",
      tp: null,
      sl: null,
      rationale: "No hay suficientes velas reales para calcular EMA20, EMA50 y RSI.",
    };
  }
  const atr = atr14 && atr14 > 0 ? atr14 : price * 0.01;
  if (hasLong && ema20 < ema50) {
    return { action: "close", confidence: null, risk: "medio", tp: null, sl: null, rationale: "EMA20 cruzó por debajo de EMA50. La regla cierra el largo." };
  }
  if (hasShort && ema20 > ema50) {
    return { action: "close", confidence: null, risk: "medio", tp: null, sl: null, rationale: "EMA20 cruzó por encima de EMA50. La regla cierra el corto." };
  }
  if (!hasLong && !hasShort && ema20 > ema50 && rsi14 < 70) {
    return {
      action: "open_long",
      confidence: null,
      risk: "medio",
      tp: price + atr * 3,
      sl: price - atr * 1.5,
      rationale: "EMA20 por encima de EMA50 y RSI por debajo de 70. Regla de cruce, no es una predicción de un modelo.",
    };
  }
  if (!hasLong && !hasShort && ema20 < ema50 && rsi14 > 30) {
    return {
      action: "open_short",
      confidence: null,
      risk: "medio",
      tp: price - atr * 3,
      sl: price + atr * 1.5,
      rationale: "EMA20 por debajo de EMA50 y RSI por encima de 30. Regla de cruce, no es una predicción de un modelo.",
    };
  }
  return {
    action: "hold",
    confidence: null,
    risk: "medio",
    tp: null,
    sl: null,
    rationale: "Ninguna regla de entrada o salida se cumple.",
  };
}
