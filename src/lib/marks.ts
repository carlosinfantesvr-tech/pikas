export interface MarkSpec {
  label: string;
  initials: string;
  hue: number;
  src?: string;
  mono?: boolean;
}

export const ASSET_MARKS: Record<string, MarkSpec> = {
  BTC: { label: "Bitcoin", initials: "₿", hue: 35, src: "/brands/assets/btc.svg" },
  ETH: { label: "Ethereum", initials: "Ξ", hue: 230, src: "/brands/assets/eth.svg" },
  SOL: { label: "Solana", initials: "S", hue: 280, src: "/brands/assets/sol.svg" },
  XRP: { label: "XRP", initials: "X", hue: 210, src: "/brands/assets/xrp.svg" },
  ADA: { label: "Cardano", initials: "A", hue: 220, src: "/brands/assets/ada.svg" },
  DOGE: { label: "Dogecoin", initials: "Ð", hue: 42, src: "/brands/assets/doge.svg" },
  LINK: { label: "Chainlink", initials: "L", hue: 210, src: "/brands/assets/link.svg" },
  AVAX: { label: "Avalanche", initials: "Av", hue: 0, src: "/brands/assets/avax.svg" },
  AAPL: { label: "Apple", initials: "Ap", hue: 0, src: "/brands/assets/aapl.svg", mono: true },
  MSFT: { label: "Microsoft", initials: "Ms", hue: 200, src: "/brands/assets/msft.svg", mono: true },
  NVDA: { label: "NVIDIA", initials: "Nv", hue: 90, src: "/brands/assets/nvda.svg", mono: true },
  SPX: { label: "S&P 500", initials: "SP", hue: 150 },
  ORO: { label: "Oro", initials: "Au", hue: 42 },
  NDX: { label: "Nasdaq 100", initials: "Nq", hue: 200 },
};

export const AI_MARKS: Record<string, MarkSpec> = {
  gemini: { label: "Google Gemini", initials: "Ge", hue: 270, src: "/brands/ai/gemini.svg", mono: true },
  groq: { label: "Groq", initials: "Gq", hue: 18 },
  openrouter: { label: "OpenRouter", initials: "Or", hue: 210, src: "/brands/ai/openrouter.svg", mono: true },
  cloudflare: { label: "Cloudflare", initials: "Cf", hue: 25, src: "/brands/ai/cloudflare.svg", mono: true },
  huggingface: { label: "Hugging Face", initials: "HF", hue: 48, src: "/brands/ai/huggingface.svg", mono: true },
  mistral: { label: "Mistral", initials: "Mi", hue: 20, src: "/brands/ai/mistral.svg", mono: true },
  cerebras: { label: "Cerebras", initials: "Cb", hue: 190 },
  sambanova: { label: "SambaNova", initials: "Sn", hue: 330 },
  nvidia: { label: "NVIDIA", initials: "Nv", hue: 90, src: "/brands/ai/nvidia.svg", mono: true },
  ollama: { label: "Ollama", initials: "Ol", hue: 0, src: "/brands/ai/ollama.svg", mono: true },
  openai: { label: "OpenAI", initials: "OA", hue: 150, src: "/brands/ai/openai.svg", mono: true },
  anthropic: { label: "Anthropic", initials: "An", hue: 25, src: "/brands/ai/anthropic.svg", mono: true },
  xai: { label: "xAI", initials: "x", hue: 0, src: "/brands/ai/xai.svg", mono: true },
  baseline: { label: "Regla local", initials: "Rx", hue: 160 },
};

export function assetMark(symbol: string): MarkSpec {
  return ASSET_MARKS[symbol] || { label: symbol, initials: symbol.slice(0, 2), hue: 200 };
}

export function aiMark(id: string): MarkSpec {
  const key = id.split("-")[0];
  return AI_MARKS[key] || AI_MARKS[id] || { label: id, initials: id.slice(0, 2).toUpperCase(), hue: 250 };
}
