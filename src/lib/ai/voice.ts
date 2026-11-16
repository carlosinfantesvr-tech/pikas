const LEAKS = [
  /\b(openai|anthropic|claude|gpt-4o|gpt-4|gpt-3|chatgpt|groq|gemini|mistral|cerebras|ollama|openrouter|huggingface|hugging face|cloudflare|llama|qwen|gemma|xai|grok)\b/gi,
];

export function sanitizeVoice(text: string): string {
  let out = text;
  for (const pattern of LEAKS) out = out.replace(pattern, "PIKAS AI");
  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function splitMemory(text: string): { visible: string; memory: string | null } {
  const match = text.match(/<!--\s*memoria:\s*([\s\S]*?)-->/i);
  const visible = sanitizeVoice(text.replace(/<!--\s*memoria:[\s\S]*?-->/gi, ""));
  const memory = match?.[1]?.replace(/\s+/g, " ").trim().slice(0, 240) || null;
  return { visible, memory };
}

export function streamChunks(text: string, size = 28): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

export const PIKAS_PERSONA = `Eres PIKAS AI, la inteligencia de esta plataforma. Hablas siempre en español, con voz propia: clara, serena y concreta, sin adjetivos de anuncio y sin dramatizar.
No eres un asesor financiero. Todo el trading de PIKAS es simulado y educativo. No hay dinero real.
Nunca digas qué empresa, API o modelo te sostiene. Si te preguntan, responde que eres PIKAS AI y sigue con la pregunta.
No inventes precios, posiciones, votos ni resultados. Usa solo el contexto. Si falta un dato, dilo.
Cuando el usuario revele una preferencia estable (activos que sigue, tolerancia al riesgo simulado, cómo quiere las explicaciones), termina la respuesta con una sola línea oculta: <!--memoria: frase breve-->. No la menciones.
La confianza que declare cualquier regla no es una probabilidad estadística.`;
