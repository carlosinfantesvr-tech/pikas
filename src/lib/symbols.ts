export interface Asset {
  symbol: string;
  name: string;
  kind: "crypto" | "equity" | "index";
  coinbase?: string;
  kraken?: string;
  gecko?: string;
  yahoo?: string;
  funding?: string;
}

export const ASSETS: Asset[] = [
  { symbol: "BTC", name: "Bitcoin", kind: "crypto", coinbase: "BTC-USD", kraken: "XBTUSD", gecko: "bitcoin", funding: "PF_XBTUSD" },
  { symbol: "ETH", name: "Ethereum", kind: "crypto", coinbase: "ETH-USD", kraken: "ETHUSD", gecko: "ethereum", funding: "PF_ETHUSD" },
  { symbol: "SOL", name: "Solana", kind: "crypto", coinbase: "SOL-USD", kraken: "SOLUSD", gecko: "solana", funding: "PF_SOLUSD" },
  { symbol: "XRP", name: "XRP", kind: "crypto", coinbase: "XRP-USD", kraken: "XRPUSD", gecko: "ripple" },
  { symbol: "ADA", name: "Cardano", kind: "crypto", coinbase: "ADA-USD", kraken: "ADAUSD", gecko: "cardano" },
  { symbol: "DOGE", name: "Dogecoin", kind: "crypto", coinbase: "DOGE-USD", kraken: "XDGUSD", gecko: "dogecoin" },
  { symbol: "LINK", name: "Chainlink", kind: "crypto", coinbase: "LINK-USD", kraken: "LINKUSD", gecko: "chainlink" },
  { symbol: "AVAX", name: "Avalanche", kind: "crypto", coinbase: "AVAX-USD", kraken: "AVAXUSD", gecko: "avalanche-2" },
  { symbol: "BNB", name: "BNB", kind: "crypto", coinbase: "BNB-USD", kraken: "BNBUSD", gecko: "binancecoin" },
  { symbol: "DOT", name: "Polkadot", kind: "crypto", coinbase: "DOT-USD", kraken: "DOTUSD", gecko: "polkadot" },
  { symbol: "LTC", name: "Litecoin", kind: "crypto", coinbase: "LTC-USD", kraken: "LTCUSD", gecko: "litecoin" },
  { symbol: "POL", name: "Polygon", kind: "crypto", kraken: "POLUSD", gecko: "polygon-ecosystem-token", yahoo: "POL-USD" },
  { symbol: "AAPL", name: "Apple", kind: "equity", yahoo: "AAPL" },
  { symbol: "MSFT", name: "Microsoft", kind: "equity", yahoo: "MSFT" },
  { symbol: "NVDA", name: "NVIDIA", kind: "equity", yahoo: "NVDA" },
  { symbol: "TSLA", name: "Tesla", kind: "equity", yahoo: "TSLA" },
  { symbol: "AMZN", name: "Amazon", kind: "equity", yahoo: "AMZN" },
  { symbol: "GOOGL", name: "Alphabet", kind: "equity", yahoo: "GOOGL" },
  { symbol: "META", name: "Meta", kind: "equity", yahoo: "META" },
  { symbol: "SPX", name: "S&P 500", kind: "index", yahoo: "^GSPC" },
  { symbol: "ORO", name: "Oro", kind: "index", yahoo: "GC=F" },
  { symbol: "NDX", name: "Nasdaq 100", kind: "index", yahoo: "^NDX" },
];

export const ASSET_SYMBOLS = ASSETS.map((asset) => asset.symbol);

export function marketNote(asset: Pick<Asset, "kind" | "symbol">): string {
  if (asset.kind === "crypto") return "Cripto, casi 24/7. Se lee Kraken; si falla, Coinbase y luego CoinGecko.";
  if (asset.symbol === "ORO") return "Futuro de oro (GC=F) en Yahoo Finance. Fuera de la sesión el dato es el último cierre y no es ejecutable.";
  return "Bolsa de EE. UU., de lunes a viernes. Fuente: Yahoo Finance. Fuera de horario se muestra el cierre previo y no se puede operar.";
}
