import { describe, expect, it } from "vitest";
import { cacheKey, chooseModel, compressContext, estimateCostUsd, fallbackOrder, type ProviderModel } from "../src/lib/ai/router-core";
import { parseAnthropicSse, parseOpenAiSse } from "../src/lib/ai/sse";
import { buildGoogleAuthUrl, createPkce, decideGoogleAccess, exchangeGoogleCode, googleOAuthConfigured } from "../src/lib/auth/google-policy";

const models: ProviderModel[] = [
  { provider: "openai", tier: "cheap", model: "gpt-4o-mini", configured: false, estInputPerMTok: 0.15, estOutputPerMTok: 0.6 },
  { provider: "openai", tier: "strong", model: "gpt-4o", configured: false, estInputPerMTok: 2.5, estOutputPerMTok: 10 },
  { provider: "anthropic", tier: "cheap", model: "claude-haiku", configured: true, estInputPerMTok: 0.8, estOutputPerMTok: 4 },
  { provider: "anthropic", tier: "strong", model: "claude-sonnet", configured: true, estInputPerMTok: 3, estOutputPerMTok: 15 },
];

describe("router de IA", () => {
  it("informa de que no hay proveedor configurado", () => {
    const choice = chooseModel({
      task: "simple",
      models: models.map((m) => ({ ...m, configured: false })),
      spentToday: 0,
      spentMonth: 0,
      dailyBudget: 1,
      monthlyBudget: 10,
    });
    expect(choice.ok).toBe(false);
    if (!choice.ok) expect(choice.code).toBe("not_configured");
  });

  it("elige un modelo barato para una pregunta simple y uno potente para análisis", () => {
    const simple = chooseModel({ task: "simple", models, spentToday: 0, spentMonth: 0, dailyBudget: 1, monthlyBudget: 10 });
    const analysis = chooseModel({
      task: "market_analysis",
      models,
      spentToday: 0,
      spentMonth: 0,
      dailyBudget: 1,
      monthlyBudget: 10,
    });
    expect(simple.ok && simple.tier).toBe("cheap");
    expect(analysis.ok && analysis.tier).toBe("strong");
  });

  it("respeta el presupuesto y el fallback", () => {
    const blocked = chooseModel({ task: "simple", models, spentToday: 1, spentMonth: 1, dailyBudget: 1, monthlyBudget: 10 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("budget");
    const order = fallbackOrder(models, { provider: "anthropic", model: "claude-sonnet" });
    expect(order[0]?.model).toBe("claude-sonnet");
    expect(order.every((m) => m.configured)).toBe(true);
  });

  it("recorta el contexto y estima el coste", () => {
    const packed = compressContext("a".repeat(500), 80);
    expect(packed.truncated).toBe(true);
    expect(packed.text.length).toBeLessThanOrEqual(80);
    const cost = estimateCostUsd(models[3], 1_000_000, 1_000_000);
    expect(cost).toBe(18);
    expect(cacheKey(["a", "b"])).toHaveLength(8);
  });
});

describe("Google OAuth (sin llamar a Google)", () => {
  it("no está configurado si falta alguna clave", () => {
    expect(googleOAuthConfigured({})).toBe(false);
    expect(googleOAuthConfigured({ clientId: "x" })).toBe(false);
    expect(googleOAuthConfigured({ clientId: "x", clientSecret: "y" })).toBe(true);
  });

  it("construye la URL de autorización con el redirect indicado", () => {
    const url = new URL(
      buildGoogleAuthUrl({
        clientId: "client",
        redirectUri: "https://pikas.vercel.app/api/auth/google/callback",
        state: "abc",
        codeChallenge: "challenge",
      }),
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://pikas.vercel.app/api/auth/google/callback");
    expect(url.searchParams.get("client_id")).toBe("client");
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const pkce = createPkce();
    expect(pkce.verifier.length).toBeGreaterThan(20);
    expect(pkce.challenge).not.toBe(pkce.verifier);
  });

  it("solo deja entrar a cuentas existentes, allowlist o invitación", () => {
    expect(decideGoogleAccess({ email: "a@b.c", emailVerified: false, existing: false, existingDisabled: false, allowlisted: true, inviteValid: false }).ok).toBe(false);
    const stranger = decideGoogleAccess({
      email: "a@b.c",
      emailVerified: true,
      existing: false,
      existingDisabled: false,
      allowlisted: false,
      inviteValid: false,
    });
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.code).toBe("not_allowed");
    expect(
      decideGoogleAccess({ email: "a@b.c", emailVerified: true, existing: false, existingDisabled: false, allowlisted: true, inviteValid: false }),
    ).toEqual({ ok: true, action: "create" });
    expect(
      decideGoogleAccess({ email: "a@b.c", emailVerified: true, existing: true, existingDisabled: false, allowlisted: false, inviteValid: false }),
    ).toEqual({ ok: true, action: "login" });
    expect(
      decideGoogleAccess({
        email: "admin@pikas.test",
        emailVerified: true,
        existing: false,
        existingDisabled: false,
        allowlisted: false,
        inviteValid: false,
        registrationOpen: true,
      }),
    ).toEqual({ ok: true, action: "create" });
  });

  it("intercambia el código con un fetch simulado", async () => {
    const calls: string[] = [];
    let body = "";
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push(String(url));
      if (String(url).includes("oauth2.googleapis.com")) body = String(init?.body || "");
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "token-test" }), { status: 200 });
      }
      return new Response(JSON.stringify({ sub: "sub-1", email: "Ana@Example.com", email_verified: true, name: "Ana" }), { status: 200 });
    };
    const profile = await exchangeGoogleCode({
      code: "code",
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "https://pikas.vercel.app/api/auth/google/callback",
      codeVerifier: "verifier-test",
      fetchImpl,
    });
    expect(body).toContain("code_verifier=verifier-test");
    expect(profile.email).toBe("ana@example.com");
    expect(profile.sub).toBe("sub-1");
    expect(calls).toHaveLength(2);
  });
});

describe("parsers de streaming", () => {
  it("lee deltas de OpenAI y Anthropic", () => {
    const openai = parseOpenAiSse('data: {"choices":[{"delta":{"content":"Hola"}}]}\n\ndata: [DONE]\n');
    expect(openai.map((d) => d.text).join("")).toBe("Hola");
    expect(openai.some((d) => d.done)).toBe(true);
    const anthropic = parseAnthropicSse(
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"PIKAS"}}\n\n',
    );
    expect(anthropic[0]?.text).toBe("PIKAS");
  });
});
