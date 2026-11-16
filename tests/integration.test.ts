import { afterEach, describe, expect, it } from "vitest";
import { completeGoogleProfile, createInvite, createSession, loginUser, registerUser, userFromToken } from "../src/lib/auth";
import { createBattle, voteBattle, advanceBattles } from "../src/lib/battle";
import { buildPikasContext } from "../src/lib/context";
import { createMemoryDb, type Db } from "../src/lib/db";
import { parseCoinbaseCandles, parseKrakenTicker, parseYahooChart } from "../src/lib/market";
import { aiConfigured } from "../src/lib/ai";
import { runArena } from "../src/lib/arena";
import { accountView, closeUserPosition, createUserAccount, getUserAccount, placeUserOrder, type QuoteView } from "../src/lib/trading";

let db: Db;

function quote(price: string, executable = true): QuoteView {
  return { symbol: "BTC", price, executable, source: "prueba", status: executable ? "live" : "delayed", providerTs: Date.now(), fetchedAt: Date.now() };
}

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
});

describe("plataforma con base de datos", () => {
  it("registra con invitación, aísla cuentas y no opera con precio viejo", async () => {
    db = await createMemoryDb();
    const admin = await registerUser(db, { email: "admin@pikas.test", username: "admin", password: "clave-segura-1", inviteCode: undefined });
    expect(admin.ok).toBe(false);
    process.env.INVITE_REQUIRED = "false";
    const createdAdmin = await registerUser(db, { email: "admin@pikas.test", username: "admin", password: "clave-segura-1" });
    expect(createdAdmin.ok).toBe(true);
    if (!createdAdmin.ok) return;
    await db.query("update users set role = 'admin' where id = $1", [createdAdmin.user.id]);
    process.env.INVITE_REQUIRED = "true";
    const code = await createInvite(db, createdAdmin.user.id, 1);
    const ana = await registerUser(db, { email: "ana@pikas.test", username: "ana", password: "clave-segura-1", inviteCode: code });
    const repeated = await registerUser(db, { email: "luis@pikas.test", username: "luis", password: "clave-segura-1", inviteCode: code });
    expect(ana.ok).toBe(true);
    expect(repeated.ok).toBe(false);
    if (!ana.ok) return;
    const bad = await loginUser(db, { email: "ana@pikas.test", password: "no-es-esta" });
    expect(bad.ok).toBe(false);
    const session = await loginUser(db, { email: "ana@pikas.test", password: "clave-segura-1" });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const token = await createSession(db, session.user.id);
    expect((await userFromToken(db, token))?.id).toBe(session.user.id);

    const account = await createUserAccount(db, ana.user.id, "100");
    expect(account.ok).toBe(true);
    if (!account.ok) return;
    const stale = await placeUserOrder(db, account.id, { symbol: "BTC", side: "long", type: "market", margin: "10", leverage: 5 }, quote("100", false));
    expect(stale.ok).toBe(false);
    const opened = await placeUserOrder(db, account.id, { symbol: "BTC", side: "long", type: "market", margin: "10", leverage: 5 }, quote("100"));
    expect(opened.ok).toBe(true);
    const view = await accountView(db, account.id, [quote("110")]);
    expect(view.positions).toHaveLength(1);
    expect(Number(view.positions[0]?.upnl)).toBeGreaterThan(0);

    const other = await createUserAccount(db, createdAdmin.user.id, "50");
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    const otherView = await accountView(db, other.id, [quote("110")]);
    expect(otherView.positions).toHaveLength(0);
    expect(otherView.balance).toBe("50.00000000");

    const closed = await closeUserPosition(db, account.id, view.positions[0]!.id, 100, quote("110"));
    expect(closed.ok).toBe(true);
    const after = await getUserAccount(db, ana.user.id);
    expect(Number(after?.balance)).toBeGreaterThan(100);

    const battle = await createBattle(db, createdAdmin.user.id, { symbol: "BTC", voteMinutes: 5, competeMinutes: 30, rewardPct: "1", riskPct: "1" }, 1_000);
    expect(battle.ok).toBe(true);
    if (!battle.ok) return;
    expect((await voteBattle(db, ana.user.id, battle.id, "up", 2_000)).ok).toBe(true);
    await db.query("update battles set vote_ends_at = $1 where id = $2", [1_500, battle.id]);
    await advanceBattles(db, [quote("100")], async () => [], 2_000);
    const live = await db.query<{ status: string; start_price: string }>("select status, start_price from battles where id = $1", [battle.id]);
    expect(live[0]?.status).toBe("live");
    expect(live[0]?.start_price).toBe("100");
    await advanceBattles(
      db,
      [quote("102")],
      async () => [{ ts: 2_100, high: "102", low: "100", close: "101.5" }],
      3_000,
    );
    const scores = await db.query("select points, correct from battle_scores where battle_id = $1 and user_id = $2", [battle.id, ana.user.id]);
    expect(Number(scores[0]?.points)).toBeGreaterThan(0);

    const denied = await completeGoogleProfile(db, { sub: "g1", email: "nueva@pikas.test", emailVerified: true, name: "Nueva" }, null);
    expect(denied.ok).toBe(false);
    process.env.GOOGLE_ALLOWED_EMAILS = "nueva@pikas.test";
    const allowed = await completeGoogleProfile(db, { sub: "g1", email: "nueva@pikas.test", emailVerified: true, name: "Nueva" }, null);
    expect(allowed.ok).toBe(true);
    delete process.env.GOOGLE_ALLOWED_EMAILS;

    expect(aiConfigured()).toBe(false);
    const context = await buildPikasContext(db, ana.user.id);
    expect(context).toContain("BTC");
    expect(context).not.toContain("te recomiendo comprar");

    await db.query(
      "insert into agents (id, slug, name, kind, provider, description) values ($1,'baseline','Baseline','rules',null,'reglas')",
      [crypto.randomUUID()],
    );
    const arena = await runArena(
      db,
      ana.user.id,
      {
        symbol: "BTC",
        mode: "competition",
        quote: quote("100"),
        bars: Array.from({ length: 60 }, (_, i) => ({ ts: i, open: 80 + i * 0.2, high: 81 + i * 0.2, low: 79 + i * 0.2, close: 80 + i * 0.2, volume: 3 })),
      },
    );
    expect(arena.ok).toBe(true);
    if (!arena.ok) return;
    expect(arena.decisions.some((item) => item.agent === "baseline")).toBe(true);
  });
});

describe("parsers de mercado", () => {
  it("lee Kraken, Coinbase y Yahoo sin inventar campos", () => {
    const kraken = parseKrakenTicker({
      result: { XXBTZUSD: { c: ["65000.1", "0.1"], o: "64000", v: ["1", "2"] } },
    });
    expect(kraken[0]?.symbol).toBe("BTC");
    expect(kraken[0]?.source).toBe("Kraken");
    expect(kraken[0]?.changeBasis).toBe("day_open");
    const candles = parseCoinbaseCandles([[1_700_000_000, 10, 12, 11, 11.5, 4]]);
    expect(candles[0]?.low).toBe("10.00000000");
    expect(candles[0]?.high).toBe("12.00000000");
    const yahoo = parseYahooChart("AAPL", {
      chart: {
        result: [
          {
            meta: { regularMarketPrice: 100, chartPreviousClose: 90, regularMarketTime: 1_700_000_000, regularMarketVolume: 10 },
            timestamp: [1_700_000_000],
            indicators: { quote: [{ open: [99], high: [101], low: [98], close: [100], volume: [10] }] },
          },
        ],
      },
    });
    expect(yahoo.quote?.source).toBe("Yahoo Finance");
    expect(yahoo.quote?.changeBasis).toBe("previous_close");
    expect(yahoo.candles).toHaveLength(1);
  });
});
