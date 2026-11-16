"use client";

import { useEffect, useRef } from "react";
import { useReduced } from "./ui";

export interface CandlePoint {
  ts: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string | null;
}

export function CandleChart({ candles, overlays }: { candles: CandlePoint[]; overlays?: Array<{ ts: number; ema20: number | null; ema50: number | null }> }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReduced();
  useEffect(() => {
    const el = ref.current;
    if (!el || !candles.length) return;
    let disposed = false;
    let chart: { remove: () => void } | null = null;
    (async () => {
      const { createChart, ColorType, CrosshairMode } = await import("lightweight-charts");
      if (disposed || !ref.current) return;
      const instance = createChart(ref.current, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9aa6b8", fontFamily: "IBM Plex Mono, ui-monospace, monospace" },
        grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
        timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: false },
        crosshair: { mode: CrosshairMode.Normal },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { mouseWheel: true, pinch: true },
        kineticScroll: { touch: !reduced, mouse: false },
      });
      const series = instance.addCandlestickSeries({
        upColor: "#3ddc97",
        downColor: "#ff6b81",
        borderUpColor: "#3ddc97",
        borderDownColor: "#ff6b81",
        wickUpColor: "#3ddc97",
        wickDownColor: "#ff6b81",
      });
      series.setData(candles.map((candle) => ({
        time: Math.floor(candle.ts / 1000) as never,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      })));
      if (overlays?.length) {
        const ema20 = instance.addLineSeries({ color: "#67e8f9", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
        const ema50 = instance.addLineSeries({ color: "#f5b942", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
        ema20.setData(overlays.filter((point) => point.ema20 != null).map((point) => ({ time: Math.floor(point.ts / 1000) as never, value: point.ema20 as number })));
        ema50.setData(overlays.filter((point) => point.ema50 != null).map((point) => ({ time: Math.floor(point.ts / 1000) as never, value: point.ema50 as number })));
      }
      const volume = instance.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" } });
      volume.setData(candles.filter((candle) => candle.volume != null).map((candle) => ({
        time: Math.floor(candle.ts / 1000) as never,
        value: Number(candle.volume),
        color: Number(candle.close) >= Number(candle.open) ? "rgba(61,220,151,.35)" : "rgba(255,107,129,.35)",
      })));
      instance.priceScale("vol").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
      instance.timeScale().fitContent();
      chart = instance;
    })();
    return () => {
      disposed = true;
      chart?.remove();
    };
  }, [candles, overlays, reduced]);
  if (!candles.length) return <div className="chart-empty">Sin velas reales para este intervalo.</div>;
  return <div ref={ref} className="chart-canvas chart-reveal" />;
}

export function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="spark spark-empty" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 28 - ((value - min) / span) * 24;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg className="spark" viewBox="0 0 100 32" aria-hidden>
      <path d={d} fill="none" stroke={up ? "#3ddc97" : "#ff6b81"} strokeWidth="2" />
    </svg>
  );
}
