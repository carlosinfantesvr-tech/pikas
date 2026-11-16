import { afterEach, describe, expect, it } from "vitest";
import { arenaBoard, runArena } from "../src/lib/arena";
import { createMemoryDb } from "../src/lib/db";
import type { QuoteView } from "../src/lib/trading";

afterEach(() => {
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.AI_ALLOW_PAID;
});

const quote: QuoteView = {
  symbol: "BTC",
  price: "100",
  executable: true,
  source: "prueba",
  status: "live",
  providerTs: Date.now(),
  fetchedAt: Date.now(),
};

describe("bots de la arena", () => {
  it("muestra cada motor gratis como no configurado y no le abre cuenta", async () => {
    const db = await createMemoryDb();
    const board = await arenaBoard(db);
    for (const provider of ["gemini", "groq", "openrouter", "cloudflare", "huggingface", "mistral", "ollama"]) {
      const rows = board.agents.filter((item) => item.provider === provider);
      expect(rows.length, provider).toBeGreaterThan(0);
      expect(rows.every((item) => item.configured === false && item.account_id == null)).toBe(true);
    }
    const run = await runArena(db, "user-1", {
      symbol: "BTC",
      mode: "competition",
      quote,
      bars: Array.from({ length: 40 }, (_, i) => ({ ts: i, open: 90 + i, high: 91 + i, low: 89 + i, close: 90 + i, volume: 2 })),
    });
    expect(run.ok).toBe(true);
    const notes = await db.query<{ provider: string; action: string; executed: number }>(
      "select provider, action, executed from agent_decisions",
    );
    expect(notes.filter((note) => note.provider === "groq").every((note) => note.action === "unavailable" && Number(note.executed) === 0)).toBe(true);
    const accounts = await db.query("select id from accounts where owner_type = 'agent'");
    expect(accounts.length).toBe(1);
  });

  it("un motor con clave opera solo en su cuenta y el resto sigue sin operar", async () => {
    process.env.GROQ_API_KEY = "clave-de-prueba";
    const db = await createMemoryDb();
    const hosts: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      hosts.push(new URL(String(url)).host);
      const stream = new ReadableStream({
        start(controller) {
          const body = `data: {"choices":[{"delta":{"content":"{\\"action\\":\\"open_long\\",\\"confidence\\":0.4,\\"rationale\\":\\"cruce alcista en el contexto\\"}"}}]}\n\ndata: [DONE]\n`;
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    };
    const run = await runArena(
      db,
      "user-1",
      { symbol: "BTC", mode: "competition", quote, bars: Array.from({ length: 5 }, (_, i) => ({ ts: i, open: 1, high: 1, low: 1, close: 1, volume: 1 })) },
      Date.now(),
      fetchImpl,
    );
    expect(run.ok).toBe(true);
    expect(hosts.every((host) => host.includes("groq"))).toBe(true);
    const groq = await db.query<{ account_id: string }>("select account_id from agents where provider = 'groq' and account_id is not null");
    expect(groq.length).toBeGreaterThan(0);
    const positions = await db.query("select id from positions where account_id = $1 and status = 'open'", [groq[0]?.account_id]);
    expect(positions.length).toBe(1);
    const gemini = await db.query<{ account_id: string | null }>("select account_id from agents where provider = 'gemini'");
    expect(gemini.every((row) => row.account_id == null)).toBe(true);
  });
});
