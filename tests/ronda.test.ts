import { describe, expect, it } from "vitest";
import {
  chainHash,
  contrarioSide,
  dadoSide,
  GENESIS_HASH,
  historyWeight,
  levelsFor,
  openSessions,
  parseAiSide,
  partialR,
  predictionCanonical,
  qualifiesForSeason,
  resolveSide,
  rupturaSide,
  reversionSide,
  teamAverage,
  validateFreeCall,
  verifyLink,
  volatilityLevels,
  zonedTimestamp,
  type MinuteCandle,
} from "../src/engine/ronda";

function candle(ts: number, low: string, high: string, close: string): MinuteCandle {
  return { ts, low, high, close };
}

describe("ronda unida", () => {
  it("fija el stop en el percentil de rango y el objetivo en 1,5 veces", () => {
    const candles = Array.from({ length: 12 }, (_, index) => candle(index, "99", String(100 + index * 0.1), "100"));
    const levels = volatilityLevels("100", candles);
    expect(levels).not.toBeNull();
    if (!levels) return;
    expect(Number(levels.targetPct)).toBeCloseTo(Number(levels.stopPct) * 1.5, 4);
    const up = levelsFor("100", levels.stopPct, "up");
    const down = levelsFor("100", levels.stopPct, "down");
    expect(Number(up.stop)).toBeLessThan(100);
    expect(Number(up.target)).toBeGreaterThan(100);
    expect(Number(down.stop)).toBeGreaterThan(100);
    expect(Number(down.target)).toBeLessThan(100);
  });

  it("si objetivo y stop caen en el mismo minuto, cuenta el stop", () => {
    const levels = levelsFor("100", "1.0000", "up");
    const result = resolveSide({
      side: "up",
      entry: "100",
      stop: levels.stop,
      target: levels.target,
      startAt: 0,
      endAt: 120_000,
      candles: [candle(60_000, "98", "102", "100")],
    });
    expect(result.outcome).toBe("stop");
    expect(result.points).toBe("-1.0000");
  });

  it("paga 1,5 al objetivo y una R parcial al cierre", () => {
    const hit = resolveSide({
      side: "up",
      entry: "100",
      stop: "99",
      target: "101.5",
      startAt: 0,
      endAt: 180_000,
      candles: [candle(60_000, "99.5", "101.5", "101.2")],
    });
    expect(hit.outcome).toBe("target");
    expect(hit.points).toBe("1.5000");
    const close = resolveSide({
      side: "up",
      entry: "100",
      stop: "99",
      target: "101.5",
      startAt: 0,
      endAt: 180_000,
      candles: [candle(60_000, "99.4", "100.4", "100.5")],
    });
    expect(close.outcome).toBe("close");
    expect(close.points).toBe(partialR("up", "100", "99", "100.5"));
    expect(close.points).toBe("0.5000");
  });

  it("no inventa resultado si faltan velas", () => {
    const result = resolveSide({
      side: "down",
      entry: "100",
      stop: "101",
      target: "98.5",
      candles: [],
      startAt: 0,
      endAt: 60_000,
    });
    expect(result.outcome).toBe("unverifiable");
    expect(result.points).toBeNull();
  });

  it("los bots se abstienen cuando no hay señal, y el dado es estable", () => {
    expect(dadoSide("ronda-1")).toBe(dadoSide("ronda-1"));
    expect(contrarioSide([])).toBeNull();
    expect(contrarioSide(["up", "up", "down"])).toBe("down");
    expect(contrarioSide(["up", "down"])).toBeNull();
    expect(rupturaSide(["1", "2", "3"])).toBeNull();
    expect(rupturaSide(["10", "11", "10", "11", "10", "12"])).toBe("up");
    expect(reversionSide(["100", "100", "100", "100", "100", "100", "100", "110"])).toBe("down");
  });

  it("la comunidad exige quórum y pondera el historial", () => {
    expect(historyWeight(2, 2)).toBe(1);
    expect(historyWeight(10, 10)).toBe(1.5);
    expect(teamAverage([{ points: "1.5000", weight: 1 }, { points: "-1.0000", weight: 1 }], 3)).toBeNull();
    expect(teamAverage([
      { points: "1.5000", weight: 1 },
      { points: "1.5000", weight: 1 },
      { points: "-1.0000", weight: 1 },
    ], 3)).toBe("0.6667");
  });

  it("la temporada pide 10 rondas y el modo libre rechaza stops absurdos", () => {
    expect(qualifiesForSeason(9)).toBe(false);
    expect(qualifiesForSeason(10)).toBe(true);
    expect(validateFreeCall({ side: "up", entry: "100", stop: "80", target: "110", horizon: "4h" }).ok).toBe(false);
    expect(validateFreeCall({ side: "up", entry: "100", stop: "99", target: "99.2", horizon: "24h" }).ok).toBe(false);
    const ok = validateFreeCall({ side: "down", entry: "100", stop: "102", target: "97", horizon: "1w" });
    expect(ok.ok).toBe(true);
  });

  it("encadena SHA-256 y no acepta un voto de IA sin JSON claro", () => {
    const canonical = predictionCanonical({
      id: "p1",
      kind: "ronda",
      actor: "user:a",
      side: "up",
      entry: "100.00000000",
      stop: "99.00000000",
      target: "101.50000000",
      createdAt: 10,
    });
    const hash = chainHash(GENESIS_HASH, canonical);
    expect(verifyLink(GENESIS_HASH, canonical, hash)).toBe(true);
    expect(verifyLink(GENESIS_HASH, `${canonical}|x`, hash)).toBe(false);
    expect(parseAiSide("yo creo que sube")).toBeNull();
    expect(parseAiSide('{"side":"up","reason":"el cierre rompe el máximo reciente"}')?.side).toBe("up");
  });

  it("ancla Londres a las 09:00 de Madrid", () => {
    const starts = zonedTimestamp(2026, 11, 17, 9, 0, "Europe/Madrid");
    expect(starts).toBe(Date.UTC(2026, 10, 17, 8, 0));
    const open = openSessions(starts - 60_000);
    expect(open.some((slot) => slot.key.endsWith("londres") && slot.phase === "voting")).toBe(true);
    const live = openSessions(starts + 60_000);
    expect(live.some((slot) => slot.key.endsWith("londres") && slot.phase === "live")).toBe(true);
  });
});
