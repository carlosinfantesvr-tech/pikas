import type { Db } from "./db";
import { q } from "../engine/money";
import { ASSETS, type Asset } from "./symbols";

export type { Asset };
export { ASSETS };

export interface QuoteDraft {
  symbol: string;
  price: string;
  changeValue: string | null;
  changeBasis: "24h" | "day_open" | "previous_close" | null;
  volume: string | null;
  source: string;
  providerTs: number | null;
}

export interface CandleDraft {
  ts: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
  source: string;
}

export function assetBySymbol(symbol: string): Asset | undefined {
  return ASSETS.find((asset) => asset.symbol === symbol);
}

export function parseKrakenTicker(payload: unknown): QuoteDraft[] {
  const result = (payload as { result?: Record<string, Record<string, unknown>> }).result;
  if (!result) return [];
  const out: QuoteDraft[] = [];
  for (const asset of ASSETS) {
    if (!asset.kraken) continue;
    const needle = asset.kraken!.replace("USD", "");
    const key = Object.keys(result)
      .filter((name) => name.includes(needle) && name.endsWith("USD"))
      .sort((a, b) => a.length - b.length)[0];
    const row = key ? result[key] : undefined;
    if (!row) continue;
    const last = Array.isArray(row.c) ? String(row.c[0]) : null;
    const open = typeof row.o === "string" ? row.o : null;
    const volume = Array.isArray(row.v) ? String(row.v[1] ?? row.v[0]) : null;
    if (!last || Number(last) <= 0) continue;
    const change = open && Number(open) > 0 ? String(((Number(last) - Number(open)) / Number(open)) * 100) : null;
    out.push({
      symbol: asset.symbol,
      price: q(last),
      changeValue: change,
      changeBasis: change ? "day_open" : null,
      volume,
      source: "Kraken",
      providerTs: Date.now(),
    });
  }
  return out;
}

export function parseCoinbaseTicker(symbol: string, payload: unknown): QuoteDraft | null {
  const row = payload as { price?: string; time?: string; volume?: string };
  if (!row.price || Number(row.price) <= 0) return null;
  return {
    symbol,
    price: q(row.price),
    changeValue: null,
    changeBasis: null,
    volume: row.volume ?? null,
    source: "Coinbase",
    providerTs: row.time ? Date.parse(row.time) : Date.now(),
  };
}

export function parseCoinGecko(payload: unknown): QuoteDraft[] {
  const body = payload as Record<string, { usd?: number; usd_24h_change?: number; usd_24h_vol?: number }>;
  const out: QuoteDraft[] = [];
  for (const asset of ASSETS) {
    if (!asset.gecko) continue;
    const row = body[asset.gecko];
    if (!row?.usd || row.usd <= 0) continue;
    out.push({
      symbol: asset.symbol,
      price: q(row.usd),
      changeValue: row.usd_24h_change === undefined ? null : String(row.usd_24h_change),
      changeBasis: row.usd_24h_change === undefined ? null : "24h",
      volume: row.usd_24h_vol === undefined ? null : String(row.usd_24h_vol),
      source: "CoinGecko",
      providerTs: Date.now(),
    });
  }
  return out;
}

export function parseCoinbaseCandles(payload: unknown, source = "Coinbase"): CandleDraft[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((row) => {
      const [time, low, high, open, close, volume] = row as number[];
      if (!time || !close) return null;
      return {
        ts: time * 1000,
        open: q(open),
        high: q(high),
        low: q(low),
        close: q(close),
        volume: volume === undefined ? null : String(volume),
        source,
      };
    })
    .filter((row): row is CandleDraft => Boolean(row))
    .sort((a, b) => a.ts - b.ts);
}

export function parseKrakenCandles(payload: unknown): CandleDraft[] {
  const result = (payload as { result?: Record<string, unknown> }).result;
  if (!result) return [];
  const series = Object.values(result).find((value) => Array.isArray(value)) as unknown[] | undefined;
  if (!series) return [];
  return series
    .map((row) => {
      const [time, open, high, low, close, , volume] = row as (string | number)[];
      return {
        ts: Number(time) * 1000,
        open: q(String(open)),
        high: q(String(high)),
        low: q(String(low)),
        close: q(String(close)),
        volume: volume === undefined ? null : String(volume),
        source: "Kraken",
      };
    })
    .filter((row) => row.ts > 0 && Number(row.close) > 0)
    .sort((a, b) => a.ts - b.ts);
}

export function parseYahooChart(symbol: string, payload: unknown): { quote: QuoteDraft | null; candles: CandleDraft[] } {
  const result = (payload as { chart?: { result?: Array<Record<string, unknown>> } }).chart?.result?.[0];
  if (!result) return { quote: null, candles: [] };
  const meta = result.meta as {
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    previousClose?: number;
    regularMarketVolume?: number;
    regularMarketTime?: number;
  };
  const timestamps = (result.timestamp as number[]) || [];
  const quote = (result.indicators as { quote?: Array<Record<string, Array<number | null>>> })?.quote?.[0];
  const candles: CandleDraft[] = [];
  if (quote && timestamps.length) {
    for (let i = 0; i < timestamps.length; i++) {
      const close = quote.close?.[i];
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      if (close == null || open == null || high == null || low == null) continue;
      candles.push({
        ts: timestamps[i] * 1000,
        open: q(open),
        high: q(high),
        low: q(low),
        close: q(close),
        volume: quote.volume?.[i] == null ? null : String(quote.volume[i]),
        source: "Yahoo Finance",
      });
    }
  }
  if (!meta?.regularMarketPrice || meta.regularMarketPrice <= 0) return { quote: null, candles };
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  const change = prev && prev > 0 ? String(((meta.regularMarketPrice - prev) / prev) * 100) : null;
  return {
    quote: {
      symbol,
      price: q(meta.regularMarketPrice),
      changeValue: change,
      changeBasis: change ? "previous_close" : null,
      volume: meta.regularMarketVolume ? String(meta.regularMarketVolume) : null,
      source: "Yahoo Finance",
      providerTs: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
    },
    candles,
  };
}

export function parseKrakenFunding(payload: unknown): Array<{ symbol: string; rate: string }> {
  const tickers = (payload as { tickers?: Array<{ symbol?: string; relativeFundingRate?: number }> }).tickers || [];
  const out: Array<{ symbol: string; rate: string }> = [];
  for (const asset of ASSETS) {
    if (!asset.funding) continue;
    const row = tickers.find((ticker) => ticker.symbol === asset.funding);
    if (!row || row.relativeFundingRate === undefined || Number.isNaN(row.relativeFundingRate)) continue;
    out.push({ symbol: asset.symbol, rate: String(row.relativeFundingRate) });
  }
  return out;
}

const CRYPTO_MAX_AGE = 90_000;
const EQUITY_MAX_AGE = 15 * 60_000;

export function quoteStatus(asset: Asset, providerTs: number | null, fetchedAt: number, now: number): { executable: boolean; status: string } {
  const age = providerTs ? now - providerTs : now - fetchedAt;
  const max = asset.kind === "crypto" ? CRYPTO_MAX_AGE : EQUITY_MAX_AGE;
  if (age <= max) return { executable: true, status: "live" };
  if (asset.kind !== "crypto") return { executable: false, status: "market_closed" };
  return { executable: false, status: "delayed" };
}

async function fetchJson(url: string, fetchImpl: typeof fetch, headers?: Record<string, string>): Promise<unknown> {
  const response = await fetchImpl(url, { headers, cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

export async function refreshMarket(db: Db, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = [];
  const failed: string[] = [];
  const quotes = new Map<string, QuoteDraft>();

  try {
    const pairs = ASSETS.filter((asset) => asset.kraken).map((asset) => asset.kraken).join(",");
    const payload = await fetchJson(`https://api.kraken.com/0/public/Ticker?pair=${pairs}`, fetchImpl);
    for (const quote of parseKrakenTicker(payload)) {
      quotes.set(quote.symbol, quote);
      ok.push(`kraken:${quote.symbol}`);
    }
  } catch (error) {
    failed.push(`kraken:${error instanceof Error ? error.message : "error"}`);
  }

  await Promise.all(
    ASSETS.filter((asset) => asset.coinbase && !quotes.has(asset.symbol)).map(async (asset) => {
      try {
        const payload = await fetchJson(`https://api.exchange.coinbase.com/products/${asset.coinbase}/ticker`, fetchImpl);
        const quote = parseCoinbaseTicker(asset.symbol, payload);
        if (quote) {
          quotes.set(asset.symbol, quote);
          ok.push(`coinbase:${asset.symbol}`);
        }
      } catch (error) {
        failed.push(`coinbase:${asset.symbol}:${error instanceof Error ? error.message : "error"}`);
      }
    }),
  );

  try {
    const ids = ASSETS.filter((asset) => asset.gecko).map((asset) => asset.gecko).join(",");
    const key = process.env.COINGECKO_API_KEY;
    const payload = await fetchJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`,
      fetchImpl,
      key ? { "x-cg-demo-api-key": key } : undefined,
    );
    for (const quote of parseCoinGecko(payload)) {
      const current = quotes.get(quote.symbol);
      if (!current) quotes.set(quote.symbol, quote);
      else if (quote.changeBasis === "24h") {
        current.changeValue = quote.changeValue;
        current.changeBasis = "24h";
        if (!current.volume) current.volume = quote.volume;
      }
      ok.push(`coingecko:${quote.symbol}`);
    }
  } catch (error) {
    failed.push(`coingecko:${error instanceof Error ? error.message : "error"}`);
  }

  for (const asset of ASSETS.filter((item) => item.yahoo)) {
    try {
      const payload = await fetchJson(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.yahoo!)}?interval=1h&range=5d`,
        fetchImpl,
        { "user-agent": "PIKAS/0.1 (educational paper trading)" },
      );
      const parsed = parseYahooChart(asset.symbol, payload);
      if (parsed.quote) {
        quotes.set(asset.symbol, parsed.quote);
        ok.push(`yahoo:${asset.symbol}`);
        await storeCandles(db, asset.symbol, "1h", parsed.candles);
      } else failed.push(`yahoo:${asset.symbol}:sin precio`);
    } catch (error) {
      failed.push(`yahoo:${asset.symbol}:${error instanceof Error ? error.message : "error"}`);
    }
  }

  for (const asset of ASSETS) {
    const quote = quotes.get(asset.symbol);
    if (!quote) {
      const existing = await db.query("select symbol from quotes where symbol = $1", [asset.symbol]);
      if (existing.length) {
        await db.query("update quotes set executable = 0, status = 'delayed', detail = $2, fetched_at = fetched_at where symbol = $1", [
          asset.symbol,
          "La fuente no respondió. Se conserva el último precio y no es ejecutable.",
        ]);
      } else {
        await db.query(
          `insert into quotes (symbol, price, source, fetched_at, executable, status, detail)
           values ($1,'0','ninguna',$2,0,'unavailable',$3)
           on conflict (symbol) do update set executable = 0, status = 'unavailable', detail = $3`,
          [asset.symbol, now, "Sin precio real disponible."],
        );
      }
      continue;
    }
    const status = quoteStatus(asset, quote.providerTs, now, now);
    await db.query(
      `insert into quotes (symbol, price, change_value, change_basis, volume, source, provider_ts, fetched_at, executable, status, detail)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null)
       on conflict (symbol) do update set
         price = excluded.price, change_value = excluded.change_value, change_basis = excluded.change_basis,
         volume = excluded.volume, source = excluded.source, provider_ts = excluded.provider_ts,
         fetched_at = excluded.fetched_at, executable = excluded.executable, status = excluded.status, detail = null`,
      [
        quote.symbol,
        quote.price,
        quote.changeValue,
        quote.changeBasis,
        quote.volume,
        quote.source,
        quote.providerTs,
        now,
        status.executable ? 1 : 0,
        status.status,
      ],
    );
  }

  try {
    const payload = await fetchJson("https://futures.kraken.com/derivatives/api/v3/tickers", fetchImpl);
    const rates = parseKrakenFunding(payload);
    for (const rate of rates) {
      await db.query(
        `insert into funding_rates (symbol, rate, source, fetched_at, status, detail)
         values ($1,$2,'Kraken Futures',$3,'live',null)
         on conflict (symbol) do update set rate = excluded.rate, source = excluded.source, fetched_at = excluded.fetched_at, status = 'live', detail = null`,
        [rate.symbol, rate.rate, now],
      );
    }
    if (!rates.length) failed.push("funding:sin tasas");
    else ok.push("funding");
  } catch (error) {
    failed.push(`funding:${error instanceof Error ? error.message : "error"}`);
    await db.query("update funding_rates set status = 'unavailable', detail = $1", [
      error instanceof Error ? error.message.slice(0, 180) : "sin tasa",
    ]);
  }

  return { ok, failed };
}

export async function storeCandles(db: Db, symbol: string, interval: string, candles: CandleDraft[]): Promise<void> {
  for (const candle of candles) {
    await db.query(
      `insert into candles (symbol, interval, ts, open, high, low, close, volume, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (symbol, interval, ts) do update set
         open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume, source = excluded.source`,
      [symbol, interval, candle.ts, candle.open, candle.high, candle.low, candle.close, candle.volume, candle.source],
    );
  }
}

const INTERVALS: Record<string, { coinbase: number; kraken: number; yahoo: string; range: string }> = {
  "1m": { coinbase: 60, kraken: 1, yahoo: "1m", range: "1d" },
  "5m": { coinbase: 300, kraken: 5, yahoo: "5m", range: "5d" },
  "15m": { coinbase: 900, kraken: 15, yahoo: "15m", range: "5d" },
  "1h": { coinbase: 3600, kraken: 60, yahoo: "1h", range: "1mo" },
  "1d": { coinbase: 86400, kraken: 1440, yahoo: "1d", range: "1y" },
};

export async function loadCandles(
  db: Db,
  symbol: string,
  interval: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ candles: CandleDraft[]; source: string | null; error: string | null }> {
  const asset = assetBySymbol(symbol);
  const spec = INTERVALS[interval];
  if (!asset || !spec) return { candles: [], source: null, error: "Intervalo o activo no soportado." };
  try {
    let candles: CandleDraft[] = [];
    if (asset.coinbase) {
      try {
        const payload = await fetchJson(
          `https://api.exchange.coinbase.com/products/${asset.coinbase}/candles?granularity=${spec.coinbase}`,
          fetchImpl,
        );
        candles = parseCoinbaseCandles(payload);
      } catch {
        candles = [];
      }
      if (!candles.length && asset.kraken) {
        const payload = await fetchJson(
          `https://api.kraken.com/0/public/OHLC?pair=${asset.kraken}&interval=${spec.kraken}`,
          fetchImpl,
        );
        candles = parseKrakenCandles(payload);
      }
    } else if (asset.yahoo) {
      const payload = await fetchJson(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.yahoo)}?interval=${spec.yahoo}&range=${spec.range}`,
        fetchImpl,
        { "user-agent": "PIKAS/0.1 (educational paper trading)" },
      );
      candles = parseYahooChart(asset.symbol, payload).candles;
    }
    if (!candles.length) return { candles: [], source: null, error: "El proveedor no devolvió velas." };
    await storeCandles(db, symbol, interval, candles.slice(-400));
    return { candles: candles.slice(-400), source: candles[0]?.source ?? null, error: null };
  } catch (error) {
    const cached = await db.query<CandleDraft & { source: string }>(
      "select ts, open, high, low, close, volume, source from candles where symbol = $1 and interval = $2 order by ts asc",
      [symbol, interval],
    );
    if (!cached.length) return { candles: [], source: null, error: error instanceof Error ? error.message : "sin velas" };
    return { candles: cached, source: cached[0]?.source ?? null, error: "Mostrando velas guardadas: la fuente no respondió ahora." };
  }
}

export async function listQuotes(db: Db) {
  const rows = await db.query(
    "select symbol, price, change_value, change_basis, volume, source, provider_ts, fetched_at, executable, status, detail from quotes order by symbol",
  );
  const bySymbol = new Map(rows.map((row) => [String(row.symbol), row]));
  return ASSETS.map((asset) => {
    const row = bySymbol.get(asset.symbol);
    if (!row || row.status === "unavailable" || row.price === "0" || row.price === "0.00000000") {
      return {
        symbol: asset.symbol,
        name: asset.name,
        kind: asset.kind,
        price: null,
        changeValue: null,
        changeBasis: null,
        volume: null,
        source: null,
        providerTs: null,
        fetchedAt: null,
        executable: false,
        status: "unavailable",
        detail: (row?.detail as string) || "Sin datos reales.",
      };
    }
    return {
      symbol: asset.symbol,
      name: asset.name,
      kind: asset.kind,
      price: String(row.price),
      changeValue: row.change_value == null ? null : String(row.change_value),
      changeBasis: (row.change_basis as string) || null,
      volume: row.volume == null ? null : String(row.volume),
      source: String(row.source),
      providerTs: row.provider_ts == null ? null : Number(row.provider_ts),
      fetchedAt: Number(row.fetched_at),
      executable: Number(row.executable) === 1,
      status: String(row.status),
      detail: row.detail == null ? null : String(row.detail),
    };
  });
}
