import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { ASSET_SYMBOLS } from "../src/lib/symbols";

describe("contrato visual", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  it("tiene transiciones, destellos, esqueletos y respeta menos movimiento", () => {
    expect(css).toContain("page-enter");
    expect(css).toContain("tick-up");
    expect(css).toContain("tick-down");
    expect(css).toContain("chartIn");
    expect(css).toContain("shimmer");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain('html[data-motion="off"]');
  });

  it("el catálogo público incluye los mercados comprobados", () => {
    for (const symbol of ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "LINK", "AVAX", "AAPL", "MSFT", "NVDA", "SPX"]) {
      expect(ASSET_SYMBOLS).toContain(symbol);
    }
  });
});
