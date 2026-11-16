export interface CompositeInput {
  returnPct: number | null;
  winRate: number | null;
  closedTrades: number;
  maxDrawdownPct: number | null;
}

export function maxDrawdown(equities: number[]): number | null {
  if (equities.length < 2) return null;
  let peak = equities[0];
  let maxDd = 0;
  for (const equity of equities) {
    if (equity > peak) peak = equity;
    if (peak > 0) maxDd = Math.max(maxDd, (peak - equity) / peak);
  }
  return maxDd;
}

export function compositeScore(input: CompositeInput): { score: number | null; reason: string } {
  if (input.closedTrades < 3 || input.returnPct === null || input.winRate === null || input.maxDrawdownPct === null) {
    return { score: null, reason: "Hacen falta al menos 3 operaciones cerradas y una curva de patrimonio." };
  }
  const returnScore = Math.max(-1, Math.min(1, input.returnPct / 0.2));
  const winScore = Math.max(0, Math.min(1, input.winRate));
  const ddScore = 1 - Math.max(0, Math.min(1, input.maxDrawdownPct / 0.3));
  const raw = 0.45 * returnScore + 0.25 * winScore + 0.3 * ddScore;
  const score = Math.round(((raw + 1) / 2) * 1000) / 10;
  return {
    score,
    reason: "45% rentabilidad normalizada (±20% = extremos), 25% win rate, 30% drawdown (30% = suelo). No gana solo el más rentable.",
  };
}
