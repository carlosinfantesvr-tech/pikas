import { describe, expect, it } from "vitest";
import { gradeLesson, LESSONS } from "../src/engine/academy";
import { rankLeague } from "../src/engine/league";
import { parseKrakenTicker } from "../src/lib/market";

describe("ligas y academia", () => {
  it("ordena la liga por rentabilidad y deja sin puesto inventado a quien no tiene cuenta", () => {
    const rows = rankLeague([
      { userId: "a", username: "ana", equity: 80, initial: 100 },
      { userId: "b", username: "boa", equity: 150, initial: 100 },
      { userId: "c", username: "cio", equity: null, initial: null },
    ]);
    expect(rows.map((row) => row.username)).toEqual(["boa", "ana", "cio"]);
    expect(rows[2]?.returnPct).toBeNull();
  });

  it("la academia solo aprueba la respuesta correcta", () => {
    expect(LESSONS).toHaveLength(5);
    expect(gradeLesson("stop", 1)).toBe(true);
    expect(gradeLesson("stop", 0)).toBe(false);
    expect(gradeLesson("no-existe", 0)).toBe(false);
  });

  it("si Kraken devuelve POL y POLS, se queda con el par más corto", () => {
    const rows = parseKrakenTicker({
      result: {
        POLSUSD: { c: ["0.4", "1"], o: "0.5", v: ["1", "2"] },
        POLUSD: { c: ["0.2", "1"], o: "0.25", v: ["1", "2"] },
      },
    });
    const pol = rows.find((row) => row.symbol === "POL");
    expect(pol?.price).toBe("0.20000000");
  });
});
