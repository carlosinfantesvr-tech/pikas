import { d, q } from "./money";

export interface Bar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorPoint {
  ts: number;
  sma20: number | null;
  ema20: number | null;
  ema50: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  bbMid: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  atr14: number | null;
  vwap: number | null;
}

function sma(values: number[], period: number, index: number): number | null {
  if (index + 1 < period) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i++) sum += values[i];
  return sum / period;
}

function emaSeries(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i + 1 < period) {
      out.push(null);
      continue;
    }
    if (prev === null) {
      prev = sma(values, period, i);
      out.push(prev);
      continue;
    }
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsiSeries(values: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const rsiAt = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[period] = rsiAt(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const g = change > 0 ? change : 0;
    const l = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = rsiAt(avgGain, avgLoss);
  }
  return out;
}

function atrSeries(bars: Bar[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  const trs: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      trs.push(bars[i].high - bars[i].low);
      continue;
    }
    const prev = bars[i - 1].close;
    trs.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - prev), Math.abs(bars[i].low - prev)));
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trs[i];
  let atr = sum / period;
  out[period] = atr;
  for (let i = period + 1; i < bars.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    out[i] = atr;
  }
  return out;
}

export function computeIndicators(bars: Bar[]): IndicatorPoint[] {
  const closes = bars.map((b) => b.close);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const rsi = rsiSeries(closes, 14);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine: number[] = closes.map((_, i) =>
    ema12[i] !== null && ema26[i] !== null ? (ema12[i] as number) - (ema26[i] as number) : NaN,
  );
  const macdValues = macdLine.map((v) => (Number.isNaN(v) ? 0 : v));
  const signalRaw = emaSeries(
    macdLine.map((v) => (Number.isNaN(v) ? 0 : v)),
    9,
  );
  const atr = atrSeries(bars, 14);
  let cumPv = 0;
  let cumV = 0;
  return bars.map((bar, i) => {
    const typical = (bar.high + bar.low + bar.close) / 3;
    cumPv += typical * (bar.volume || 0);
    cumV += bar.volume || 0;
    const mid = sma(closes, 20, i);
    let sd: number | null = null;
    if (mid !== null) {
      let acc = 0;
      for (let j = i - 19; j <= i; j++) acc += (closes[j] - mid) ** 2;
      sd = Math.sqrt(acc / 20);
    }
    const macd = ema12[i] !== null && ema26[i] !== null ? macdValues[i] : null;
    const signal = macd !== null && i >= 26 + 8 ? signalRaw[i] : null;
    return {
      ts: bar.ts,
      sma20: mid,
      ema20: ema20[i],
      ema50: ema50[i],
      rsi14: rsi[i],
      macd,
      macdSignal: signal,
      macdHist: macd !== null && signal !== null ? macd - signal : null,
      bbMid: mid,
      bbUpper: mid !== null && sd !== null ? mid + 2 * sd : null,
      bbLower: mid !== null && sd !== null ? mid - 2 * sd : null,
      atr14: atr[i],
      vwap: cumV > 0 ? cumPv / cumV : null,
    };
  });
}

export function latestIndicators(bars: Bar[]): IndicatorPoint | null {
  const all = computeIndicators(bars);
  return all.length ? all[all.length - 1] : null;
}

export function num(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

export function roundInd(value: number | null, dp = 6): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return q(d(value).toDecimalPlaces(dp));
}
