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
import { buildGoogleAuthUrl, createPkce, exchangeGoogleCode, googleOAuthConfigured } from "@/lib/auth/google-policy";
import { createBattle, listBattles, voteBattle } from "@/lib/battle";
import { castPoll, castRondaVote, chainExport, createFreeCall, latestBrief, pollTally, readSentiment, rondaView, seasonBoard, verifyHash } from "@/lib/ronda";
import { homePayload, iaBoard, parseFavorites, progressView } from "@/lib/home";
import { createLeague, joinLeague, leagueBoard, listLeagues } from "@/lib/league";
import { ACADEMY_BADGE, gradeLesson, LESSONS } from "@/engine/academy";
import { notifyOnce } from "@/lib/notify";
import { ASSET_SYMBOLS } from "@/lib/symbols";
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

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
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

  if (path === "public/cadena" && method === "GET") {
    const chain = await chainExport(db);
    const url = new URL(req.url);
    if (url.searchParams.get("format") === "csv") {
      const header = "prev_hash,hash,kind,created_at,ok,canonical";
      const lines = chain.rows.map((row) => [row.prev_hash, row.hash, row.kind, row.created_at, row.ok, JSON.stringify(row.canonical)].join(","));
      return new NextResponse([header, ...lines].join("\n"), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=pikas-cadena.csv" },
      });
    }
    return json(chain);
  }
  if (path === "public/resultado.svg" && method === "GET") {
    const rows = await db.query<{ label: string; resolution: string | null; symbol: string }>(
      "select label, resolution, symbol from rondas where status = 'resolved' order by resolved_at desc limit 1",
    );
    const row = rows[0];
    const title = row ? `${row.label}` : "Sin ronda resuelta";
    const detail = row ? `${row.symbol} · ${row.resolution || "resuelta"}` : "Todavía no hay un resultado real que compartir.";
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#08090d"/>
  <text x="80" y="180" fill="#f5b942" font-size="28" font-family="sans-serif">PIKAS · simulación</text>
  <text x="80" y="280" fill="#e8edf5" font-size="64" font-family="sans-serif">${title.replace(/[<>&]/g, "")}</text>
  <text x="80" y="360" fill="#93a0b4" font-size="32" font-family="sans-serif">${detail.replace(/[<>&]/g, "")}</text>
  <text x="80" y="520" fill="#67e8f9" font-size="24" font-family="sans-serif">Sin dinero real. Fuente: rondas guardadas.</text>
</svg>`;
    return new NextResponse(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store" } });
  }
  if (path === "public/perfil" && method === "GET") {
    const username = (new URL(req.url).searchParams.get("username") || "").toLowerCase();
    const users = await db.query<{ id: string; username: string; avatar_hue: number; created_at: number }>(
      "select id, username, avatar_hue, created_at from users where username = $1 and disabled = 0",
      [username],
    );
    const person = users[0];
    if (!person) return fail("Ese perfil no existe.", "NOT_FOUND", 404);
    const progress = await progressView(db, person.id);
    const account = await db.query<{ balance: string; initial_balance: string }>(
      "select balance, initial_balance from accounts where owner_type = 'user' and owner_id = $1 limit 1",
      [person.id],
    );
    const equity = await db.query<{ ts: number; equity: string }>(
      "select ts, equity from equity_snapshots where account_id = (select id from accounts where owner_type = 'user' and owner_id = $1 limit 1) order by ts asc limit 80",
      [person.id],
    );
    return json({
      username: person.username,
      avatarHue: person.avatar_hue,
      createdAt: Number(person.created_at),
      equity: account[0]?.balance || null,
      initial: account[0]?.initial_balance || null,
      progress: { level: progress.level, badges: progress.badges.filter((badge) => badge.earned), xp: progress.xp, streakDays: progress.streakDays },
      series: equity.map((point) => ({ ts: Number(point.ts), equity: point.equity })),
      simulation: true,
    });
  }
  if (path === "public/perfil.svg" && method === "GET") {
    const username = (new URL(req.url).searchParams.get("username") || "pikas").replace(/[<>&"]/g, "").slice(0, 20);
    const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#08090d"/><text x="80" y="180" fill="#f5b942" font-size="28" font-family="sans-serif">PIKAS · simulación</text><text x="80" y="300" fill="#e8edf5" font-size="72" font-family="sans-serif">${username}</text><text x="80" y="390" fill="#93a0b4" font-size="28" font-family="sans-serif">Perfil público. Sin dinero real.</text></svg>`;
    return new NextResponse(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store" } });
  }
  if (path === "public/verificar" && method === "GET") {
    const hash = new URL(req.url).searchParams.get("hash") || "";
    if (!/^[0-9a-f]{64}$/i.test(hash)) return fail("El hash tiene que ser SHA-256 en hexadecimal.", "BAD_HASH", 400);
    return json(await verifyHash(db, hash));
  }

  if (path === "health" && method === "GET") {
    return json({ ok: true, simulation: true, db: db.kind, time: new Date().toISOString(), ai: aiConfigured(), google: googleOAuthConfigured({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }) });
  }

  if (path === "auth/google/status" && method === "GET") {
    const configured = googleOAuthConfigured({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET });
    return json({
      configured,
      label: configured ? "Continuar con Google" : "Inicio con Google no configurado",
      reason: configured ? null : "Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.",
    });
  }

  if (path === "auth/google/start" && method === "GET") {
    if (!googleOAuthConfigured({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })) {
      return fail("Inicio con Google no configurado", "not_configured", 409);
    }
    const url = new URL(req.url);
    const state = randomBytes(24).toString("base64url");
    const pkce = createPkce();
    const invite = url.searchParams.get("invite");
    const next = url.searchParams.get("next") || "/";
    await saveOauthState(db, state, invite, next.startsWith("/") ? next : "/", pkce.verifier);
    const redirect = NextResponse.redirect(
      buildGoogleAuthUrl({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        redirectUri: `${originOf(req)}/api/auth/google/callback`,
        state,
        codeChallenge: pkce.challenge,
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
    if (!saved?.code_verifier) return back("El enlace de Google caducó.");
    try {
      const profile = await exchangeGoogleCode({
        code,
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        redirectUri: `${originOf(req)}/api/auth/google/callback`,
        codeVerifier: saved.code_verifier,
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

  if (path === "ligas" && method === "GET") return json({ leagues: await listLeagues(db, user.id) });
  if (path === "ligas" && method === "POST") {
    if (!sameOrigin(req)) return fail("Origen no permitido.", "CSRF", 403);
    const input = z.object({ name: z.string() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Nombre no válido.", "BAD_INPUT", 400);
    const created = await createLeague(db, user.id, input.data.name);
    if (!created.ok) return fail(created.error, "LEAGUE", 400);
    return json(created);
  }
  if (path === "ligas/unirse" && method === "POST") {
    if (!sameOrigin(req)) return fail("Origen no permitido.", "CSRF", 403);
    const input = z.object({ code: z.string() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Código no válido.", "BAD_INPUT", 400);
    const joined = await joinLeague(db, user.id, user.username, input.data.code);
    if (!joined.ok) return fail(joined.error, "LEAGUE", 400);
    return json(joined);
  }
  if (path === "ligas/tabla" && method === "GET") {
    const id = new URL(req.url).searchParams.get("id") || "";
    const board = await leagueBoard(db, user.id, id);
    if (!board.ok) return fail(board.error, "LEAGUE", 403);
    return json(board);
  }
  if (path === "academia" && method === "GET") {
    const passed = await db.query<{ lesson_id: string }>("select lesson_id from academy_passes where user_id = $1", [user.id]);
    const done = new Set(passed.map((row) => row.lesson_id));
    return json({
      lessons: LESSONS.map(({ answer: _answer, ...lesson }) => ({ ...lesson, passed: done.has(lesson.id) })),
      badge: done.size === LESSONS.length ? ACADEMY_BADGE : null,
    });
  }
  if (path === "academia" && method === "POST") {
    if (!sameOrigin(req)) return fail("Origen no permitido.", "CSRF", 403);
    const input = z.object({ id: z.string(), choice: z.number().int() }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Respuesta no válida.", "BAD_INPUT", 400);
    if (!gradeLesson(input.data.id, input.data.choice)) return json({ ok: false, error: "Esa no es la respuesta. Vuelve a leer la lección." });
    await db.query(
      "insert into academy_passes (user_id, lesson_id, passed_at) values ($1,$2,$3) on conflict (user_id, lesson_id) do nothing",
      [user.id, input.data.id, Date.now()],
    );
    const passed = await db.query("select lesson_id from academy_passes where user_id = $1", [user.id]);
    if (passed.length === LESSONS.length) await notifyOnce(db, user.id, "logro", "Medalla de academia", "Aprobaste las cinco lecciones.");
    return json({ ok: true });
  }

  if (path === "home" && method === "GET") {
    const settings = await db.query<{ favorites: string | null }>("select favorites from user_settings where user_id = $1", [user.id]);
    return json(await homePayload(db, user.id, parseFavorites(settings[0]?.favorites)));
  }
  if (path === "progreso" && method === "GET") return json(await progressView(db, user.id));
  if (path === "ias" && method === "GET") return json({ providers: await iaBoard(db) });
  if (path === "prefs" && method === "POST") {
    if (!sameOrigin(req)) return fail("Origen no permitido.", "CSRF", 403);
    const input = z.object({
      theme: z.enum(["dark", "light"]).optional(),
      favorites: z.array(z.string()).optional(),
      tutorialDone: z.boolean().optional(),
    }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Preferencia no válida.", "BAD_INPUT", 400);
    const favorites = input.data.favorites?.map((item) => item.toUpperCase()).filter((item) => ASSET_SYMBOLS.includes(item)).join(",") ;
    await db.query("insert into user_settings (user_id) values ($1) on conflict (user_id) do nothing", [user.id]);
    if (input.data.theme) await db.query("update user_settings set theme = $2 where user_id = $1", [user.id, input.data.theme]);
    if (favorites != null) await db.query("update user_settings set favorites = $2 where user_id = $1", [user.id, favorites]);
    if (input.data.tutorialDone != null) await db.query("update user_settings set tutorial_done = $2 where user_id = $1", [user.id, input.data.tutorialDone ? 1 : 0]);
    return json({ ok: true });
  }

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
      ai: { configured: aiConfigured(), providers: user.role === "admin" ? providerInfos() : [] },
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

  if (path === "ronda" && method === "GET") {
    return json({ rondas: await rondaView(db, user.id), sentiment: await readSentiment(db), brief: await latestBrief(db) });
  }
  if (path === "ronda/vote" && method === "POST") {
    if (!sameOrigin(req)) return fail("Origen no permitido.", "CSRF", 403);
    const input = z.object({ rondaId: z.string(), side: z.enum(["up", "down"]) }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Voto no válido.", "BAD_INPUT", 400);
    const result = await castRondaVote(db, user.id, user.username, input.data.rondaId, input.data.side);
    if (!result.ok) return fail(result.error, "VOTE", 400);
    return json({ ok: true, rondas: await rondaView(db, user.id) });
  }
  if (path === "libre" && method === "GET") {
    const calls = await db.query("select * from free_calls where user_id = $1 order by created_at desc limit 40", [user.id]);
    return json({ calls });
  }
  if (path === "libre" && method === "POST") {
    if (!sameOrigin(req)) return fail("Origen no permitido.", "CSRF", 403);
    const input = z.object({
      symbol: z.string(),
      side: z.enum(["up", "down"]),
      entry: z.string(),
      stop: z.string(),
      target: z.string(),
      horizon: z.enum(["4h", "8h", "24h", "1w"]),
    }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("La llamada libre no es válida.", "BAD_INPUT", 400);
    const listed = await listQuotes(db);
    const quote = listed.find((item) => item.symbol === input.data.symbol);
    if (!quote?.executable || !quote.price) return fail("Ese activo no tiene un precio ejecutable ahora.", "NO_PRICE", 400);
    if (quote.price !== input.data.entry) return fail("La entrada tiene que ser el precio de la fuente, no uno escrito a mano.", "ENTRY", 400);
    const result = await createFreeCall(db, user.id, { ...input.data, source: quote.source }, Date.now());
    if (!result.ok) return fail(result.error, "LIBRE", 400);
    return json(result);
  }
  if (path === "temporada" && method === "GET") {
    return json({ season: await seasonBoard(db), poll: await pollTally(db), brief: await latestBrief(db) });
  }
  if (path === "temporada/encuesta" && method === "POST") {
    if (!sameOrigin(req)) return fail("Origen no permitido.", "CSRF", 403);
    const input = z.object({ choice: z.enum(["comunidad", "ia", "bots"]) }).safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("Elige comunidad, ia o bots.", "BAD_INPUT", 400);
    return json(await castPoll(db, user.id, input.data.choice));
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
    return json({ content: result.content, speaker: "PIKAS AI", at: new Date().toISOString(), symbol: input.data.symbol, disclaimer: "Educativo. No es asesoramiento financiero." });
  }

  if (path === "pikas/status" && method === "GET") {
    return json({
      configured: aiConfigured(),
      name: "PIKAS AI",
      message: aiConfigured() ? "PIKAS AI está listo." : "PIKAS AI no configurado",
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
              [crypto.randomUUID(), conversationId, result.content, JSON.stringify({ speaker: "PIKAS AI" }), Date.now()],
            );
            send({ done: true, speaker: "PIKAS AI", at: new Date().toISOString() });
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

  if (path === "router" && method === "GET") {
    if (user.role !== "admin") return json({ configured: aiConfigured(), speaker: "PIKAS AI", admin: false });
    return json({ ...(await routerView(db)), admin: true });
  }
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
