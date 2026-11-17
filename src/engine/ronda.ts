import { createHash } from "crypto";
import { d, q } from "./money";

export type Side = "up" | "down";
export type Outcome = "stop" | "target" | "close" | "unverifiable";

export interface MinuteCandle {
  ts: number;
  high: string;
  low: string;
  close: string;
}

export const GENESIS_HASH = "0".repeat(64);
export const COMMUNITY_QUORUM = 3;
export const SEASON_MIN_ROUNDS = 10;
export const STOP_PERCENTILE = 0.6;
export const TARGET_MULTIPLE = 1.5;
export const MAX_STOP_PCT = 10;
export const MIN_RR = 0.25;

export const BOTS = [
  { id: "dado", name: "Dado ciego", kind: "azar" as const },
  { id: "contra", name: "Contracorriente", kind: "contrario" as const },
  { id: "rompe", name: "Rompevallas", kind: "ruptura" as const },
  { id: "vuelta", name: "Vuelta al centro", kind: "reversion" as const },
] as const;

export const HORIZONS = {
  "4h": 4 * 60 * 60 * 1000,
  "8h": 8 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
} as const;

export type Horizon = keyof typeof HORIZONS;

export interface Clock {
  timeZone: string;
  asia: string;
  london: string;
  newyork: string;
  durationMin: number;
  voteLeadMin: number;
}

export const DEFAULT_CLOCK: Clock = {
  timeZone: "Europe/Madrid",
  asia: "02:00",
  london: "09:00",
  newyork: "15:30",
  durationMin: 240,
  voteLeadMin: 8 * 60,
};

export interface SessionSlot {
  key: string;
  label: string;
  startsAt: number;
  endsAt: number;
  voteOpensAt: number;
}

export function chainHash(prev: string, canonical: string): string {
  return createHash("sha256").update(`${prev}|${canonical}`).digest("hex");
}

export function predictionCanonical(input: {
  id: string;
  kind: string;
  actor: string;
  side: string;
  entry: string;
  stop: string;
  target: string;
  createdAt: number;
}): string {
  return [input.kind, input.id, input.actor, input.side, input.entry, input.stop, input.target, String(input.createdAt)].join("|");
}

export function verifyLink(prev: string, canonical: string, hash: string): boolean {
  return chainHash(prev, canonical) === hash;
}

export function percentile(values: number[], p: number): number | null {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (clean.length < 10) return null;
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil(p * clean.length) - 1));
  return clean[index];
}

export function rangePercents(candles: MinuteCandle[]): number[] {
  return candles
    .map((candle) => {
      const close = d(candle.close);
      if (close.lte(0)) return 0;
      return d(candle.high).minus(candle.low).div(close).times(100).toNumber();
    })
    .filter((value) => value > 0);
}

export function volatilityLevels(entry: string, candles: MinuteCandle[]): { stopPct: string; targetPct: string } | null {
  const raw = percentile(rangePercents(candles), STOP_PERCENTILE);
  if (raw == null || d(entry).lte(0)) return null;
  const stopPct = Math.min(8, Math.max(0.05, raw));
  const targetPct = stopPct * TARGET_MULTIPLE;
  return { stopPct: stopPct.toFixed(4), targetPct: targetPct.toFixed(4) };
}

export function levelsFor(entry: string, stopPct: string, side: Side): { stop: string; target: string } {
  const price = d(entry);
  const stop = d(stopPct).div(100);
  const target = stop.times(TARGET_MULTIPLE);
  if (side === "up") {
    return { stop: q(price.times(d(1).minus(stop))), target: q(price.times(d(1).plus(target))) };
  }
  return { stop: q(price.times(d(1).plus(stop))), target: q(price.times(d(1).minus(target))) };
}

function hit(side: Side, candle: MinuteCandle, stop: string, target: string): { stop: boolean; target: boolean } {
  if (side === "up") {
    return { stop: d(candle.low).lte(stop), target: d(candle.high).gte(target) };
  }
  return { stop: d(candle.high).gte(stop), target: d(candle.low).lte(target) };
}

export function partialR(side: Side, entry: string, stop: string, close: string): string {
  const risk = d(entry).minus(stop).abs();
  if (risk.lte(0)) return "0.0000";
  const favorable = side === "up" ? d(close).minus(entry) : d(entry).minus(close);
  const ratio = favorable.div(risk);
  const clamped = ratio.gt("1.5") ? d("1.5") : ratio.lt("-1") ? d("-1") : ratio;
  return clamped.toFixed(4);
}

export function resolveSide(input: {
  side: Side;
  entry: string;
  stop: string;
  target: string;
  candles: MinuteCandle[];
  startAt: number;
  endAt: number;
}): { outcome: Outcome; points: string | null; note: string; close: string | null } {
  const ordered = [...input.candles].filter((candle) => candle.ts >= input.startAt && candle.ts < input.endAt).sort((a, b) => a.ts - b.ts);
  if (!ordered.length) {
    return { outcome: "unverifiable", points: null, note: "No hay velas de 1 min en la ventana. No se inventa el resultado.", close: null };
  }
  for (const candle of ordered) {
    const touches = hit(input.side, candle, input.stop, input.target);
    if (touches.stop && touches.target) {
      return { outcome: "stop", points: "-1.0000", note: "La misma vela de 1 min toca el objetivo y el stop. Cuenta el stop.", close: candle.close };
    }
    if (touches.stop) return { outcome: "stop", points: "-1.0000", note: "El precio tocó el stop.", close: input.stop };
    if (touches.target) return { outcome: "target", points: "1.5000", note: "El precio tocó el objetivo.", close: input.target };
  }
  const last = ordered[ordered.length - 1];
  return {
    outcome: "close",
    points: partialR(input.side, input.entry, input.stop, last.close),
    note: "Ni objetivo ni stop. Se anota la R parcial del cierre.",
    close: last.close,
  };
}

export function dadoSide(seed: string): Side {
  const byte = createHash("sha256").update(`dado|${seed}`).digest()[0];
  return byte % 2 === 0 ? "up" : "down";
}

export function contrarioSide(votes: Side[]): Side | null {
  if (!votes.length) return null;
  const up = votes.filter((side) => side === "up").length;
  const down = votes.length - up;
  if (up === down) return null;
  return up > down ? "down" : "up";
}

export function rupturaSide(closes: string[]): Side | null {
  if (closes.length < 6) return null;
  const last = d(closes[closes.length - 1]);
  const window = closes.slice(-6, -1).map((value) => d(value));
  const high = window.reduce((max, value) => (value.gt(max) ? value : max));
  const low = window.reduce((min, value) => (value.lt(min) ? value : min));
  if (last.gt(high)) return "up";
  if (last.lt(low)) return "down";
  return null;
}

export function reversionSide(closes: string[]): Side | null {
  if (closes.length < 8) return null;
  const previous = closes.slice(0, -1).slice(-20);
  const mean = previous.reduce((sum, value) => sum.plus(value), d(0)).div(previous.length);
  const last = d(closes[closes.length - 1]);
  const band = mean.times("0.001");
  if (last.gt(mean.plus(band))) return "down";
  if (last.lt(mean.minus(band))) return "up";
  return null;
}

export function historyWeight(settled: number, wins: number): number {
  if (settled < 5) return 1;
  const accuracy = Math.min(1, Math.max(0, wins / settled));
  return Math.min(1.5, Math.max(0.5, 0.5 + accuracy));
}

export function teamAverage(rows: Array<{ points: string | null; weight: number }>, quorum = 0): string | null {
  const scored = rows.filter((row) => row.points != null);
  if (scored.length < quorum) return null;
  let num = d(0);
  let den = d(0);
  for (const row of scored) {
    const weight = d(row.weight);
    num = num.plus(d(row.points as string).times(weight));
    den = den.plus(weight);
  }
  if (den.lte(0)) return null;
  return num.div(den).toFixed(4);
}

export function qualifiesForSeason(rounds: number, minimum = SEASON_MIN_ROUNDS): boolean {
  return rounds >= minimum;
}

export function versusReference(points: string, reference: string | null): "por_delante" | "por_detras" | "empate" | "sin_referencia" {
  if (reference == null) return "sin_referencia";
  const delta = d(points).minus(reference);
  if (delta.gt(0)) return "por_delante";
  if (delta.lt(0)) return "por_detras";
  return "empate";
}

export function validateFreeCall(input: { side: Side; entry: string; stop: string; target: string; horizon: string }): { ok: true; stopPct: string; rr: string } | { ok: false; error: string } {
  if (!(input.horizon in HORIZONS)) return { ok: false, error: "El plazo tiene que ser 4 h, 8 h, 24 h o 1 semana." };
  let entry: ReturnType<typeof d>;
  let stop: ReturnType<typeof d>;
  let target: ReturnType<typeof d>;
  try {
    entry = d(input.entry);
    stop = d(input.stop);
    target = d(input.target);
  } catch {
    return { ok: false, error: "Los precios no son números." };
  }
  if (entry.lte(0) || stop.lte(0) || target.lte(0)) return { ok: false, error: "Los precios tienen que ser positivos." };
  if (input.side === "up" && !(stop.lt(entry) && target.gt(entry))) {
    return { ok: false, error: "En largo el stop va por debajo de la entrada y el objetivo por encima." };
  }
  if (input.side === "down" && !(stop.gt(entry) && target.lt(entry))) {
    return { ok: false, error: "En corto el stop va por encima de la entrada y el objetivo por debajo." };
  }
  const stopPct = stop.minus(entry).abs().div(entry).times(100);
  if (stopPct.gt(MAX_STOP_PCT)) return { ok: false, error: "El stop no puede alejarse más de un 10% de la entrada." };
  const rr = target.minus(entry).abs().div(stop.minus(entry).abs());
  if (rr.lt(MIN_RR)) return { ok: false, error: "La relación objetivo/stop tiene que ser al menos 0,25." };
  return { ok: true, stopPct: stopPct.toFixed(4), rr: rr.toFixed(4) };
}

export function parseAiSide(text: string): { side: Side; reason: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { side?: string; lado?: string; reason?: string; razon?: string };
    const raw = String(parsed.side || parsed.lado || "").toLowerCase();
    const side: Side | null = raw === "up" || raw === "sube" || raw === "largo" ? "up" : raw === "down" || raw === "baja" || raw === "corto" ? "down" : null;
    const reason = String(parsed.reason || parsed.razon || "").trim();
    if (!side || reason.length < 8) return null;
    return { side, reason: reason.slice(0, 600) };
  } catch {
    return null;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function zoneParts(utcMs: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || "0");
  const hour = read("hour");
  return { year: read("year"), month: read("month"), day: read("day"), hour: hour === 24 ? 0 : hour, minute: read("minute") };
}

function zoneOffset(utcMs: number, timeZone: string): number {
  const parts = zoneParts(utcMs, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - utcMs;
}

export function zonedTimestamp(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const first = utc - zoneOffset(utc, timeZone);
  return utc - zoneOffset(first, timeZone);
}

function shiftDate(year: number, month: number, day: number, delta: number): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function parseClock(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error("Hora de sesión no válida.");
  return { hour, minute };
}

export function sessionsOn(year: number, month: number, day: number, clock: Clock = DEFAULT_CLOCK): SessionSlot[] {
  const specs = [
    ["asia", "Asia", clock.asia],
    ["londres", "Londres", clock.london],
    ["nueva-york", "Nueva York", clock.newyork],
  ] as const;
  return specs.map(([id, label, hm]) => {
    const { hour, minute } = parseClock(hm);
    const startsAt = zonedTimestamp(year, month, day, hour, minute, clock.timeZone);
    return {
      key: `${year}-${pad(month)}-${pad(day)}-${id}`,
      label: `${label} ${pad(day)}/${pad(month)}`,
      startsAt,
      endsAt: startsAt + clock.durationMin * 60_000,
      voteOpensAt: startsAt - clock.voteLeadMin * 60_000,
    };
  });
}

export function openSessions(now: number, clock: Clock = DEFAULT_CLOCK): Array<SessionSlot & { phase: "voting" | "live" }> {
  const today = zoneParts(now, clock.timeZone);
  const slots: SessionSlot[] = [];
  for (let delta = -1; delta <= 2; delta += 1) {
    const day = shiftDate(today.year, today.month, today.day, delta);
    slots.push(...sessionsOn(day.year, day.month, day.day, clock));
  }
  const open: Array<SessionSlot & { phase: "voting" | "live" }> = [];
  for (const slot of slots) {
    if (now >= slot.startsAt && now < slot.endsAt) open.push({ ...slot, phase: "live" });
    else if (now >= slot.voteOpensAt && now < slot.startsAt) open.push({ ...slot, phase: "voting" });
  }
  return open;
}

export function clockFromEnv(env: NodeJS.ProcessEnv = process.env): Clock {
  return {
    timeZone: env.PIKAS_TZ || DEFAULT_CLOCK.timeZone,
    asia: env.SESSION_ASIA || DEFAULT_CLOCK.asia,
    london: env.SESSION_LONDON || DEFAULT_CLOCK.london,
    newyork: env.SESSION_NEWYORK || DEFAULT_CLOCK.newyork,
    durationMin: Number(env.SESSION_DURATION_MIN || DEFAULT_CLOCK.durationMin),
    voteLeadMin: Number(env.SESSION_VOTE_LEAD_MIN || DEFAULT_CLOCK.voteLeadMin),
  };
}
