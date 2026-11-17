import { describe, expect, it } from "vitest";
import { badgesFor, challengeDone, compareSides, dailyChallenge, levelFromXp, streakFromDays, xpFrom } from "../src/engine/progress";

describe("progreso", () => {
  it("no da medallas ni experiencia sin hechos reales", () => {
    const empty = { trades: 0, wins: 0, votes: 0, resolvedRounds: 0, freeCalls: 0, streakDays: 0 };
    expect(xpFrom(empty)).toBe(0);
    expect(badgesFor(empty).every((badge) => !badge.earned)).toBe(true);
    expect(levelFromXp(0).title).toBe("Observador");
  });

  it("cuenta racha solo en días consecutivos y el reto del día es comprobable", () => {
    expect(streakFromDays(["2026-11-15", "2026-11-16", "2026-11-17"], "2026-11-17")).toBe(3);
    expect(streakFromDays(["2026-11-10"], "2026-11-17")).toBe(0);
    const challenge = dailyChallenge("2026-11-17");
    expect(challengeDone(challenge.id, { votedToday: false, openedChart: false, compared: false })).toBe(false);
    expect(challengeDone("votar", { votedToday: true, openedChart: false, compared: false })).toBe(true);
  });

  it("compara solo rondas en las que ambos participaron", () => {
    const rows = compareSides(
      [
        { actor: "r1|user:ana", points: 1.5 },
        { actor: "r1|ia:gemini", points: -1 },
        { actor: "r2|ia:gemini", points: 1.5 },
      ],
      "ana",
    );
    expect(rows).toEqual([{ actor: "ia:gemini", user: 1.5, other: -1, rounds: 1 }]);
  });
});
