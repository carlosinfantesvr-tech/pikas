import { afterEach, describe, expect, it } from "vitest";
import { runRoutedChat } from "../src/lib/ai";
import { classifyProviderFailure, planChain, type ProviderModel } from "../src/lib/ai/router-core";
import { sanitizeVoice, splitMemory } from "../src/lib/ai/voice";
import { createMemoryDb } from "../src/lib/db";

const sample: ProviderModel[] = [
  { provider: "gemini", tier: "cheap", model: "flash", configured: true, estInputPerMTok: 0, estOutputPerMTok: 0, priority: 20, free: true, dailyCapUsd: null },
  { provider: "groq", tier: "cheap", model: "oss", configured: true, estInputPerMTok: 0, estOutputPerMTok: 0, priority: 30, free: true, dailyCapUsd: null },
  { provider: "openai", tier: "cheap", model: "mini", configured: true, estInputPerMTok: 0.15, estOutputPerMTok: 0.6, priority: 200, free: false, dailyCapUsd: 0 },
];

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.AI_ALLOW_PAID;
});

describe("cadena de motores", () => {
  it("clasifica cupo y límite, y salta los que están en pausa o sin presupuesto", () => {
    expect(classifyProviderFailure(429, "rate limit")).toBe("rate_limit");
    expect(classifyProviderFailure(402, "insufficient credits")).toBe("quota");
    const chain = planChain({
      now: 1_000,
      task: "simple",
      models: sample,
      health: [{ provider: "gemini", cooldownUntil: 5_000, consecutiveFailures: 1 }],
      spentByProvider: {},
    });
    expect(chain.map((item) => item.provider)).toEqual(["groq"]);
  });

  it("limpia la voz y separa la memoria", () => {
    expect(sanitizeVoice("Esto lo dice Groq, no GPT-4.")).not.toMatch(/groq|gpt/i);
    const split = splitMemory("Sigo tu simulación. <!--memoria: sigue BTC-->");
    expect(split.visible).not.toContain("memoria");
    expect(split.memory).toBe("sigue BTC");
  });

  it("si el primero responde 429, usa el siguiente y no enseña el nombre", async () => {
    process.env.GEMINI_API_KEY = "test-gemini";
    process.env.GROQ_API_KEY = "test-groq";
    const db = await createMemoryDb();
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const href = String(url);
      calls.push(new URL(href).host);
      if (href.includes("generativelanguage")) return new Response("rate limit", { status: 429 });
      const stream = new ReadableStream({
        start(controller) {
          const payload = `data: {"choices":[{"delta":{"content":"Miro tu simulación con calma. <!--memoria: sigue BTC-->"}}]}\n\ndata: [DONE]\n`;
          controller.enqueue(new TextEncoder().encode(payload));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    };
    const result = await runRoutedChat({
      db,
      userId: "user-1",
      task: "coordination",
      messages: [{ role: "user", content: "¿Qué ves?" }],
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain("simulación");
    expect(result.content.toLowerCase()).not.toMatch(/groq|gemini|gpt/);
    expect("provider" in result).toBe(false);
    expect(calls[0]).toContain("googleapis");
    expect(calls.some((host) => host.includes("groq"))).toBe(true);
    const health = await db.query<{ provider: string; cooldown_until: number }>("select provider, cooldown_until from ai_provider_state");
    expect(health.some((row) => row.provider === "gemini" && Number(row.cooldown_until) > Date.now())).toBe(true);
    const memory = await db.query<{ summary: string }>("select summary from ai_memory where user_id = $1", ["user-1"]);
    expect(memory[0]?.summary).toContain("BTC");
  });
});
