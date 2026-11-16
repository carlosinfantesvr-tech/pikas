export interface SseDelta {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  done?: boolean;
}

export function parseOpenAiSse(chunk: string): SseDelta[] {
  const out: SseDelta[] = [];
  for (const line of chunk.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") {
      out.push({ text: "", done: true });
      continue;
    }
    try {
      const json = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.delta?.content ?? "";
      out.push({
        text,
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
      });
    } catch {
      // fragmento incompleto: lo ignora el ensamblador superior
    }
  }
  return out;
}

export function parseAnthropicSse(chunk: string): SseDelta[] {
  const out: SseDelta[] = [];
  const blocks = chunk.split("\n\n");
  for (const block of blocks) {
    const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    try {
      const json = JSON.parse(dataLine.slice(5).trim()) as {
        type?: string;
        delta?: { type?: string; text?: string };
        usage?: { input_tokens?: number; output_tokens?: number };
        message?: { usage?: { input_tokens?: number; output_tokens?: number } };
      };
      if (json.type === "content_block_delta" && json.delta?.text) {
        out.push({ text: json.delta.text });
      }
      if (json.type === "message_delta" && json.usage) {
        out.push({ text: "", completionTokens: json.usage.output_tokens });
      }
      if (json.type === "message_start" && json.message?.usage) {
        out.push({ text: "", promptTokens: json.message.usage.input_tokens });
      }
      if (json.type === "message_stop") out.push({ text: "", done: true });
    } catch {
      // ignore
    }
  }
  return out;
}
