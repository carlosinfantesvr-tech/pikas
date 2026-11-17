import { existsSync } from "fs";
import { describe, expect, it } from "vitest";
import { AI_MARKS, ASSET_MARKS, aiMark, assetMark } from "../src/lib/marks";
import { ASSET_SYMBOLS } from "../src/lib/symbols";
import { providerInfos } from "../src/lib/ai";

describe("marcas", () => {
  it("cubre cada activo y usa un archivo local si hay logo", () => {
    for (const symbol of ASSET_SYMBOLS) {
      const mark = assetMark(symbol);
      expect(mark.initials.length).toBeGreaterThan(0);
      if (mark.src) {
        expect(mark.src.startsWith("/brands/")).toBe(true);
        expect(existsSync(`public${mark.src}`)).toBe(true);
      }
    }
    expect(ASSET_MARKS.SPX.src).toBeUndefined();
    expect(ASSET_MARKS.ORO.src).toBeUndefined();
    expect(ASSET_MARKS.NDX.src).toBeUndefined();
  });

  it("cubre cada motor y cae a iniciales si no hay SVG", () => {
    for (const provider of providerInfos()) {
      const mark = aiMark(provider.id);
      expect(mark.label.length).toBeGreaterThan(0);
      if (mark.src) expect(existsSync(`public${mark.src}`)).toBe(true);
    }
    expect(AI_MARKS.groq.src).toBeUndefined();
    expect(aiMark("gemini-rapido").label).toBe("Google Gemini");
  });
});
