import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import {
  COOKIE,
  completeGoogleProfile,
  createInvite,
  createSession,
  destroySession,
  issueResetToken,
  loginUser,
  publicUser,
  readCookie,
  registerUser,
  requestPasswordReset,
  resetPassword,
  saveOauthState,
  takeOauthState,
  userFromToken,
} from "@/lib/auth";
import { buildGoogleAuthUrl, exchangeGoogleCode, googleOAuthConfigured } from "@/lib/auth/google-policy";
import { createBattle, listBattles, voteBattle } from "@/lib/battle";
import { getDb, logEvent } from "@/lib/db";
import { loadCandles, listQuotes } from "@/lib/market";
import { latestIndicators, computeIndicators, type Bar } from "@/engine/indicators";
import { runPulse } from "@/lib/pulse";
import { arenaBoard, runArena } from "@/lib/arena";
import { arenaRankings, battleRankings, paperRankings } from "@/lib/rankings";
import {
  accountView,
  cancelUserOrder,
  closeUserPosition,
  createUserAccount,
  getUserAccount,
  placeUserOrder,
  protectUserPosition,
  resetUserAccount,
  tradeHistory,
  type QuoteView,
} from "@/lib/trading";
import { PIKAS_SYSTEM, aiConfigured, providerInfos, routerView, runRoutedChat } from "@/lib/ai";
import { buildPikasContext } from "@/lib/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function fail(error: string, code: string, status: number) {
  return json({ error, code }, status);
}

function originOf(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return host ? `${proto}://${host}` : url.origin;
}

function sessionCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

async function quotes(db: Awaited<ReturnType<typeof getDb>>): Promise<QuoteView[]> {
  return (await listQuotes(db)).map((row) => ({
    symbol: row.symbol,
    price: row.price,
    executable: row.executable,
    source: row.source,
    status: row.status,
    providerTs: row.providerTs,
    fetchedAt: row.fetchedAt,
  }));
}

async function handle(req: Request, slug: string[]): Promise<Response> {
  const path = slug.join("/");
  const method = req.method;
  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Base de datos no disponible", "DB", 500);
  }

  if (path === "health" && method === "GET") {
    return json({ ok: true, simulation: true, db: db.kind, time: new Date().toISOString(), ai: aiConfigured(), google: googleOAuthConfigured({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }) });
  }

  if (path === "auth/google/status" && method === "GET") {
    const configured = googleOAuthConfigured({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET });
    return json({ configured, label: configured ? "Google" : "Inicio con Google no configurado" });
  }

  if (path === "auth/google/start" && method === "GET") {
    if (!googleOAuthConfigured({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })) {
      return fail("Inicio con Google no configurado", "not_configured", 409);
    }
    const url = new URL(req.url);
    const state = randomBytes(24).toString("base64url");
    const invite = url.searchParams.get("invite");
    const next = url.searchParams.get("next") || "/";
    await saveOauthState(db, state, invite, next.startsWith("/") ? next : "/");
    const redirect = NextResponse.redirect(
      buildGoogleAuthUrl({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        redirectUri: `${originOf(req)}/api/auth/google/callback`,
        state,
      }),
    );
    redirect.cookies.set("pikas_oauth", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
    return redirect;
  }

  if (path === "auth/google/callback" && method === "GET") {
    const url = new URL(req.url);
    const back = (error: string) => NextResponse.redirect(`${originOf(req)}/login?error=${encodeURIComponent(error)}`);
    if (!googleOAuthConfigured({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })) return back("Inicio con Google no configurado");
    if (url.searchParams.get("error")) return back("Google canceló el acceso");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookie = readCookie(req, "pikas_oauth");
    if (!code || !state || !cookie || cookie !== state) return back("La sesión de Google no coincide. Vuelve a intentarlo.");
    const saved = await takeOauthState(db, state);
    if (!saved) return back("El enlace de Google caducó.");
    try {
      const profile = await exchangeGoogleCode({
        code,
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        redirectUri: `${originOf(req)}/api/auth/google/callback`,
      });
      const result = await completeGoogleProfile(db, profile, saved.invite_code);
      if (!result.ok) return back(result.error);
      const token = await createSession(db, result.user.id, req.headers.get("user-agent") || undefined);
      const dest = NextResponse.redirect(`${originOf(req)}${saved.next_path || "/"}`);
      dest.cookies.set("pikas_oauth", "", { path: "/", maxAge: 0 });
      return sessionCookie(dest, token);
    } catch (error) {
      await logEvent(db, "error", "google", error instanceof Error ? error.message : "oauth");
      return back("No se pudo completar el acceso con Google.");
    }
  }

  if (path === "cron/tick" && method === "GET") {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return fail("Cron no autorizado", "CRON", 401);
    const result = await runPulse(db);
    return json({ ok: true, ...result, quotes: undefined });
  }

  if (path === "auth/register" && method === "POST") {
    const input = z.object({ email: z.string().email(), username: z.string(), password: z.string(), inviteCode: z.string().optional() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Revisa el formulario.", "BAD_INPUT", 400);
    const result = await registerUser(db, input.data);
    if (!result.ok) return fail(result.error, result.code, 400);
    const token = await createSession(db, result.user.id, req.headers.get("user-agent") || undefined);
    return sessionCookie(json({ user: publicUser(result.user) }), token);
  }

  if (path === "auth/login" && method === "POST") {
    const input = z.object({ email: z.string(), password: z.string() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Revisa el formulario.", "BAD_INPUT", 400);
    const result = await loginUser(db, { ...input.data, ip: req.headers.get("x-forwarded-for") || undefined });
    if (!result.ok) return fail(result.error, result.code, result.code === "RATE" ? 429 : 401);
    const token = await createSession(db, result.user.id, req.headers.get("user-agent") || undefined);
    return sessionCookie(json({ user: publicUser(result.user) }), token);
  }

  if (path === "auth/logout" && method === "POST") {
    await destroySession(db, readCookie(req));
    const res = json({ ok: true });
    res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  if (path === "auth/forgot" && method === "POST") {
    const input = z.object({ email: z.string().email() }).safeParse(await req.json().catch(() => null));
    if (input.success) await requestPasswordReset(db, input.data.email);
    return json({ ok: true, message: "Si el correo existe, un administrador puede emitir el enlace. El envío automático de correo no está activo." });
  }

  if (path === "auth/reset" && method === "POST") {
    const input = z.object({ token: z.string(), password: z.string() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Revisa el formulario.", "BAD_INPUT", 400);
    const result = await resetPassword(db, input.data.token, input.data.password);
    if (!result.ok) return fail(result.error, "RESET", 400);
    return json({ ok: true });
  }

  const user = await userFromToken(db, readCookie(req));
  if (!user) return fail("No autenticado", "UNAUTHENTICATED", 401);

  if (path === "bootstrap" && method === "GET") {
    const listed = await listQuotes(db);
    const account = await getUserAccount(db, user.id);
    const view = account ? await accountView(db, account.id, await quotes(db)) : null;
    const unread = await db.query<{ count: number }>("select count(*)::int as count from notifications where user_id = $1 and read_at is null", [user.id]);
    const settings = await db.query("select * from user_settings where user_id = $1", [user.id]);
    return json({
      user: publicUser(user),
      account: view,
      quotes: listed,
      unread: Number(unread[0]?.count || 0),
      ai: { configured: aiConfigured(), providers: providerInfos() },
      google: { configured: googleOAuthConfigured({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }) },
      settings: settings[0] || null,
      simulation: true,
    });
  }

  if (path === "pulse" && method === "POST") {
    const result = await runPulse(db);
    const listed = await listQuotes(db);
    const account = await getUserAccount(db, user.id);
    const view = account ? await accountView(db, account.id, await quotes(db)) : null;
    const unread = await db.query<{ count: number }>("select count(*)::int as count from notifications where user_id = $1 and read_at is null", [user.id]);
    return json({ skipped: result.skipped, quotes: listed, account: view, unread: Number(unread[0]?.count || 0) });
  }

  if (path === "market/candles" && method === "GET") {
    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol") || "BTC";
    const interval = url.searchParams.get("interval") || "1h";
    const loaded = await loadCandles(db, symbol, interval);
    const bars: Bar[] = loaded.candles.map((candle) => ({
      ts: candle.ts,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume || 0),
    }));
    const indicators = computeIndicators(bars).map((point) => ({ ts: point.ts, ema20: point.ema20, ema50: point.ema50 }));
    return json({ symbol, interval, source: loaded.source, error: loaded.error, candles: loaded.candles, indicators });
  }

  if (path === "trading/account" && method === "POST") {
    const input = z.object({ initial: z.enum(["10", "50", "100", "500"]) }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Elige 10, 50, 100 o 500.", "BAD_INPUT", 400);
    const result = await createUserAccount(db, user.id, input.data.initial);
    if (!result.ok) return fail(result.error, "ACCOUNT", 400);
    return json({ ok: true });
  }

  if (path === "trading/order" && method === "POST") {
    const input = z.object({
      symbol: z.string(),
      side: z.enum(["long", "short"]),
      type: z.enum(["market", "limit", "stop_market"]),
      margin: z.string(),
      leverage: z.number().int(),
      limitPrice: z.string().optional(),
      stopPrice: z.string().optional(),
    }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Orden no válida.", "BAD_INPUT", 400);
    const account = await getUserAccount(db, user.id);
    if (!account) return fail("Primero elige un saldo simulado.", "NO_ACCOUNT", 400);
    const quote = (await quotes(db)).find((item) => item.symbol === input.data.symbol);
    const result = await placeUserOrder(db, account.id, input.data, quote);
    if (!result.ok) return fail(result.error, result.code, 400);
    return json({ ok: true, account: await accountView(db, account.id, await quotes(db)) });
  }

  if (path === "trading/close" && method === "POST") {
    const input = z.object({ positionId: z.string(), percent: z.number().min(1).max(100) }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Cierre no válido.", "BAD_INPUT", 400);
    const account = await getUserAccount(db, user.id);
    if (!account) return fail("Sin cuenta.", "NO_ACCOUNT", 400);
    const snap = await accountView(db, account.id, await quotes(db));
    const position = snap.positions.find((item) => item.id === input.data.positionId);
    const quote = (await quotes(db)).find((item) => item.symbol === position?.symbol);
    const result = await closeUserPosition(db, account.id, input.data.positionId, input.data.percent, quote);
    if (!result.ok) return fail(result.error, result.code, 400);
    return json({ ok: true, account: await accountView(db, account.id, await quotes(db)) });
  }

  if (path === "trading/tpsl" && method === "POST") {
    const input = z.object({ positionId: z.string(), tp: z.string().nullable(), sl: z.string().nullable() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Protección no válida.", "BAD_INPUT", 400);
    const account = await getUserAccount(db, user.id);
    if (!account) return fail("Sin cuenta.", "NO_ACCOUNT", 400);
    const snap = await accountView(db, account.id, await quotes(db));
    const position = snap.positions.find((item) => item.id === input.data.positionId);
    const quote = (await quotes(db)).find((item) => item.symbol === position?.symbol);
    const result = await protectUserPosition(db, account.id, input.data.positionId, input.data.tp, input.data.sl, quote);
    if (!result.ok) return fail(result.error, result.code, 400);
    return json({ ok: true });
  }

  if (path === "trading/cancel" && method === "POST") {
    const input = z.object({ orderId: z.string() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Orden no válida.", "BAD_INPUT", 400);
    const account = await getUserAccount(db, user.id);
    if (!account) return fail("Sin cuenta.", "NO_ACCOUNT", 400);
    const result = await cancelUserOrder(db, account.id, input.data.orderId);
    if (!result.ok) return fail(result.error, result.code, 400);
    return json({ ok: true });
  }

  if (path === "trading/reset" && method === "POST") {
    const input = z.object({ initial: z.enum(["10", "50", "100", "500"]) }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Saldo no válido.", "BAD_INPUT", 400);
    const account = await getUserAccount(db, user.id);
    if (!account) return fail("Sin cuenta.", "NO_ACCOUNT", 400);
    const result = await resetUserAccount(db, account.id, input.data.initial, await quotes(db));
    if (!result.ok) return fail(result.error, "RESET", 400);
    return json({ ok: true, account: await accountView(db, account.id, await quotes(db)) });
  }

  if (path === "trading/history" && method === "GET") {
    const account = await getUserAccount(db, user.id);
    if (!account) return json({ trades: [] });
    const url = new URL(req.url);
    const trades = await tradeHistory(db, account.id, {
      symbol: url.searchParams.get("symbol") || undefined,
      side: url.searchParams.get("side") || undefined,
      reason: url.searchParams.get("reason") || undefined,
    });
    const snaps = await db.query("select ts, equity, balance from equity_snapshots where account_id = $1 order by ts asc", [account.id]);
    return json({ trades, equity: snaps });
  }

  if (path === "battle" && method === "GET") return json({ battles: await listBattles(db, user.id) });
  if (path === "battle/vote" && method === "POST") {
    const input = z.object({ battleId: z.string(), direction: z.enum(["up", "down"]) }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Voto no válido.", "BAD_INPUT", 400);
    const result = await voteBattle(db, user.id, input.data.battleId, input.data.direction);
    if (!result.ok) return fail(result.error, "VOTE", 400);
    return json({ ok: true, battles: await listBattles(db, user.id) });
  }
  if (path === "battle" && method === "POST") {
    if (user.role !== "admin") return fail("Solo administración.", "FORBIDDEN", 403);
    const input = z.object({ symbol: z.string(), voteMinutes: z.number(), competeMinutes: z.number(), rewardPct: z.string(), riskPct: z.string() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Ronda no válida.", "BAD_INPUT", 400);
    const result = await createBattle(db, user.id, input.data);
    if (!result.ok) return fail(result.error, "BATTLE", 400);
    return json({ ok: true });
  }

  if (path === "rankings" && method === "GET") {
    const url = new URL(req.url);
    const window = url.searchParams.get("window") || "all";
    const since = window === "day" ? Date.now() - 86400000 : window === "week" ? Date.now() - 7 * 86400000 : window === "month" ? Date.now() - 30 * 86400000 : null;
    return json({
      paper: await paperRankings(db, await quotes(db)),
      battle: await battleRankings(db, since),
      arena: await arenaRankings(db),
      window,
      note: "El paper trading se ordena por rentabilidad sobre el saldo inicial, así no mezcla cuentas de 10 y 500 sin normalizar. La arena no declara ganador con menos de 3 cierres.",
    });
  }

  if (path === "arena" && method === "GET") return json(await arenaBoard(db));
  if (path === "arena/run" && method === "POST") {
    const input = z.object({ symbol: z.string(), mode: z.enum(["competition", "assisted", "autonomous"]) }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Arena no válida.", "BAD_INPUT", 400);
    const quote = (await quotes(db)).find((item) => item.symbol === input.data.symbol);
    if (!quote) return fail("Sin precio real para la arena.", "NO_PRICE", 400);
    const loaded = await loadCandles(db, input.data.symbol, "1h");
    if (!loaded.candles.length) return fail(loaded.error || "Sin velas reales.", "NO_CANDLES", 400);
    const bars: Bar[] = loaded.candles.map((candle) => ({ ts: candle.ts, open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume || 0) }));
    const result = await runArena(db, user.id, { symbol: input.data.symbol, mode: input.data.mode, bars, quote });
    if (!result.ok) return fail(result.error, result.code, 400);
    return json(result);
  }

  if (path === "advisor/indicators" && method === "GET") {
    const symbol = new URL(req.url).searchParams.get("symbol") || "BTC";
    const loaded = await loadCandles(db, symbol, "1h");
    const bars: Bar[] = loaded.candles.map((candle) => ({ ts: candle.ts, open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume || 0) }));
    return json({
      symbol,
      source: loaded.source,
      error: loaded.error,
      latest: latestIndicators(bars),
      label: "Cálculo local sobre velas del proveedor. No es una respuesta de un modelo de IA.",
      ai: aiConfigured(),
    });
  }

  if (path === "advisor/ask" && method === "POST") {
    if (!aiConfigured()) return fail("El asesor conversacional no está configurado. Los indicadores locales siguen disponibles.", "not_configured", 409);
    const input = z.object({ symbol: z.string(), question: z.string().min(2).max(2000) }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Pregunta no válida.", "BAD_INPUT", 400);
    const context = await buildPikasContext(db, user.id);
    const result = await runRoutedChat({
      db,
      userId: user.id,
      task: "market_analysis",
      messages: [
        { role: "system", content: `${PIKAS_SYSTEM}\n${context}` },
        { role: "user", content: input.data.question },
      ],
    });
    if (!result.ok) return fail(result.error, result.code, result.code === "budget" ? 429 : 502);
    return json({ ...result, at: new Date().toISOString(), symbol: input.data.symbol, disclaimer: "Educativo. No es asesoramiento financiero." });
  }

  if (path === "pikas/status" && method === "GET") {
    return json({
      configured: aiConfigured(),
      providers: providerInfos().map((provider) => ({ id: provider.id, label: provider.label, configured: provider.configured })),
      keys: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY"],
      message: aiConfigured() ? "PIKAS AI puede responder con un proveedor configurado." : "PIKAS AI no configurado",
    });
  }

  if (path === "pikas/messages" && method === "GET") {
    const conversations = await db.query<{ id: string }>("select id from conversations where user_id = $1 and kind = 'pikas' order by created_at desc limit 1", [user.id]);
    if (!conversations[0]) return json({ messages: [] });
    const messages = await db.query("select role, content, meta, created_at from messages where conversation_id = $1 order by created_at asc limit 80", [conversations[0].id]);
    return json({ messages });
  }

  if (path === "pikas/chat" && method === "POST") {
    if (!aiConfigured()) return fail("PIKAS AI no configurado", "not_configured", 409);
    const input = z.object({ content: z.string().min(1).max(4000) }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Mensaje vacío.", "BAD_INPUT", 400);
    const existing = await db.query<{ id: string }>("select id from conversations where user_id = $1 and kind = 'pikas' order by created_at desc limit 1", [user.id]);
    let conversationId = existing[0]?.id;
    if (!conversationId) {
      conversationId = crypto.randomUUID();
      await db.query("insert into conversations (id, user_id, kind, title, created_at) values ($1,$2,'pikas','PIKAS AI',$3)", [conversationId, user.id, Date.now()]);
    }
    await db.query("insert into messages (id, conversation_id, role, content, created_at) values ($1,$2,'user',$3,$4)", [crypto.randomUUID(), conversationId, input.data.content, Date.now()]);
    const history = await db.query<{ role: string; content: string }>("select role, content from messages where conversation_id = $1 order by created_at desc limit 8", [conversationId]);
    const context = await buildPikasContext(db, user.id);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        try {
          const result = await runRoutedChat({
            db,
            userId: user.id,
            task: "coordination",
            messages: [
              { role: "system", content: `${PIKAS_SYSTEM}\n${context}` },
              ...history.reverse().filter((message) => message.role === "user" || message.role === "assistant").map((message) => ({ role: message.role as "user" | "assistant", content: message.content })),
            ],
            onDelta: (delta) => send({ delta }),
          });
          if (!result.ok) {
            send({ error: result.error, code: result.code });
          } else {
            await db.query(
              "insert into messages (id, conversation_id, role, content, meta, created_at) values ($1,$2,'assistant',$3,$4,$5)",
              [crypto.randomUUID(), conversationId, result.content, JSON.stringify({ provider: result.provider, model: result.model, estimatedCost: result.estimatedCost, cached: result.cached }), Date.now()],
            );
            send({ done: true, provider: result.provider, model: result.model, estimatedCost: result.estimatedCost, at: new Date().toISOString() });
          }
        } catch (error) {
          send({ error: error instanceof Error ? error.message : "Error de PIKAS AI", code: "provider_error" });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
  }

  if (path === "notifications" && method === "GET") {
    const url = new URL(req.url);
    const category = url.searchParams.get("category");
    const rows = await db.query("select * from notifications where user_id = $1 order by created_at desc limit 100", [user.id]);
    return json({ notifications: category ? rows.filter((row) => row.category === category) : rows });
  }
  if (path === "notifications/read" && method === "POST") {
    await db.query("update notifications set read_at = $1 where user_id = $2 and read_at is null", [Date.now(), user.id]);
    return json({ ok: true });
  }
  if (path === "alerts" && method === "GET") return json({ alerts: await db.query("select * from alerts where user_id = $1 order by created_at desc", [user.id]) });
  if (path === "alerts" && method === "POST") {
    const input = z.object({ symbol: z.string(), kind: z.enum(["price_above", "price_below", "move_pct"]), threshold: z.string() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Alerta no válida.", "BAD_INPUT", 400);
    await db.query("insert into alerts (id, user_id, symbol, kind, threshold, enabled, created_at) values ($1,$2,$3,$4,$5,1,$6)", [crypto.randomUUID(), user.id, input.data.symbol, input.data.kind, input.data.threshold, Date.now()]);
    return json({ ok: true });
  }
  if (path === "alerts/delete" && method === "POST") {
    const input = z.object({ id: z.string() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Alerta no válida.", "BAD_INPUT", 400);
    await db.query("delete from alerts where id = $1 and user_id = $2", [input.data.id, user.id]);
    return json({ ok: true });
  }
  if (path === "settings" && method === "POST") {
    const input = z.object({
      reduceMotion: z.boolean().optional(),
      alertMovePct: z.string().optional(),
      autonomousEnabled: z.boolean().optional(),
      autonomousMaxMargin: z.string().optional(),
      autonomousMaxLeverage: z.number().optional(),
    }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Ajustes no válidos.", "BAD_INPUT", 400);
    if (input.data.autonomousEnabled && !aiConfigured()) return fail("La autonomía de PIKAS AI necesita un proveedor configurado.", "not_configured", 409);
    await db.query(
      `insert into user_settings (user_id, reduce_motion, alert_move_pct, autonomous_enabled, autonomous_max_margin, autonomous_max_leverage)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (user_id) do update set
         reduce_motion = excluded.reduce_motion,
         alert_move_pct = excluded.alert_move_pct,
         autonomous_enabled = excluded.autonomous_enabled,
         autonomous_max_margin = excluded.autonomous_max_margin,
         autonomous_max_leverage = excluded.autonomous_max_leverage`,
      [
        user.id,
        input.data.reduceMotion ? 1 : 0,
        input.data.alertMovePct || "3",
        input.data.autonomousEnabled ? 1 : 0,
        input.data.autonomousMaxMargin || "10",
        input.data.autonomousMaxLeverage || 2,
      ],
    );
    return json({ ok: true });
  }

  if (path === "router" && method === "GET") return json(await routerView(db));
  if (path === "router/budget" && method === "POST") {
    if (user.role !== "admin") return fail("Solo administración.", "FORBIDDEN", 403);
    const input = z.object({ daily: z.string(), monthly: z.string() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Presupuesto no válido.", "BAD_INPUT", 400);
    await db.query("update ai_budget set daily_usd = $1, monthly_usd = $2 where id = 1", [input.data.daily, input.data.monthly]);
    return json({ ok: true });
  }

  if (path === "admin/overview" && method === "GET") {
    if (user.role !== "admin") return fail("Solo administración.", "FORBIDDEN", 403);
    const [users, positions, events, quotesRows] = await Promise.all([
      db.query("select id, email, username, role, disabled, created_at from users order by created_at desc"),
      db.query<{ count: number }>("select count(*)::int as count from positions where status = 'open'"),
      db.query("select level, source, message, created_at from system_events order by created_at desc limit 40"),
      listQuotes(db),
    ]);
    return json({
      db: db.kind,
      users,
      openPositions: Number(positions[0]?.count || 0),
      events,
      quotes: quotesRows,
      ai: providerInfos().map((provider) => ({ id: provider.id, configured: provider.configured, label: provider.label })),
      google: googleOAuthConfigured({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }),
    });
  }
  if (path === "admin/invite" && method === "POST") {
    if (user.role !== "admin") return fail("Solo administración.", "FORBIDDEN", 403);
    const code = await createInvite(db, user.id, 5, "panel");
    return json({ code, once: true });
  }
  if (path === "admin/reset" && method === "POST") {
    if (user.role !== "admin") return fail("Solo administración.", "FORBIDDEN", 403);
    const input = z.object({ userId: z.string() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Usuario no válido.", "BAD_INPUT", 400);
    const token = await issueResetToken(db, input.data.userId);
    return json({ path: `/recuperar?token=${token}`, once: true });
  }
  if (path === "admin/allow" && method === "POST") {
    if (user.role !== "admin") return fail("Solo administración.", "FORBIDDEN", 403);
    const input = z.object({ email: z.string().email() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Correo no válido.", "BAD_INPUT", 400);
    await db.query("insert into google_allowlist (email, created_by, created_at) values ($1,$2,$3) on conflict (email) do nothing", [input.data.email.toLowerCase(), user.id, Date.now()]);
    return json({ ok: true });
  }
  if (path === "admin/user" && method === "POST") {
    if (user.role !== "admin") return fail("Solo administración.", "FORBIDDEN", 403);
    const input = z.object({ userId: z.string(), disabled: z.boolean() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Petición no válida.", "BAD_INPUT", 400);
    if (input.data.userId === user.id) return fail("No puedes desactivarte a ti mismo.", "FORBIDDEN", 400);
    await db.query("update users set disabled = $1 where id = $2", [input.data.disabled ? 1 : 0, input.data.userId]);
    return json({ ok: true });
  }

  return fail("Ruta no encontrada.", "NOT_FOUND", 404);
}

async function entry(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  try {
    return await handle(req, slug);
  } catch (error) {
    console.error(error);
    return fail("Error interno. La simulación no se ha dado por hecha.", "INTERNAL", 500);
  }
}

export const GET = entry;
export const POST = entry;
