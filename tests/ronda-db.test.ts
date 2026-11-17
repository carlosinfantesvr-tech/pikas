import { afterEach, describe, expect, it } from "vitest";
import { openSessions } from "../src/engine/ronda";
import { completeGoogleProfile, registerUser } from "../src/lib/auth";
import { createMemoryDb } from "../src/lib/db";
import { castRondaVote, chainExport, tickRondas } from "../src/lib/ronda";

afterEach(() => {
  delete process.env.INVITE_REQUIRED;
});

describe("ronda unida en base de datos", () => {
  it("encadena el voto, no inventa la IA y resuelve con velas", async () => {
    const db = await createMemoryDb();
    process.env.INVITE_REQUIRED = "false";
    const created = await registerUser(db, { email: "ana@pikas.test", username: "ana", password: "clave-segura-1" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const votingAt = Date.UTC(2026, 10, 17, 7, 0);
    const session = openSessions(votingAt).find((slot) => slot.key.endsWith("londres") && slot.phase === "voting");
    expect(session).toBeTruthy();
    if (!session) return;
    await tickRondas(db, { now: votingAt, quote: null, candles: [], askAi: async () => null });
    const rondas = await db.query<{ id: string; status: string }>("select id, status from rondas where session_key = $1", [session.key]);
    expect(rondas[0]?.status).toBe("voting");
    expect((await castRondaVote(db, created.user.id, "ana", rondas[0].id, "up", votingAt)).ok).toBe(true);
    const candles = Array.from({ length: 20 }, (_, index) => ({
      ts: session.startsAt - (20 - index) * 60_000,
      high: String(100 + index * 0.05),
      low: "99.5",
      close: "100",
    }));
    candles.push({ ts: session.startsAt + 60_000, high: "120", low: "100.2", close: "110" });
    await tickRondas(db, {
      now: session.startsAt + 1_000,
      quote: { price: "100", source: "prueba", executable: true },
      candles,
      askAi: async () => null,
    });
    const ias = await db.query("select id from ronda_picks where actor_type = 'ia'");
    expect(ias).toHaveLength(0);
    const bots = await db.query<{ display_name: string }>("select display_name from ronda_picks where actor_type = 'bot'");
    expect(bots.some((bot) => bot.display_name === "Dado ciego")).toBe(true);
    await tickRondas(db, {
      now: session.endsAt + 1_000,
      quote: { price: "100", source: "prueba", executable: true },
      candles,
      askAi: async () => null,
    });
    const mine = await db.query<{ points: string; outcome: string }>("select points, outcome from ronda_picks where actor_type = 'user'");
    expect(mine[0]?.outcome).toBe("target");
    expect(mine[0]?.points).toBe("1.5000");
    const chain = await chainExport(db);
    expect(chain.intact).toBe(true);
    expect(chain.rows.length).toBeGreaterThan(1);
  });

  it("vincula Google con la cuenta que ya tiene el mismo correo", async () => {
    const db = await createMemoryDb();
    process.env.INVITE_REQUIRED = "false";
    const created = await registerUser(db, { email: "admin@pikas.test", username: "admin", password: "clave-segura-1" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await db.query("update users set role = 'admin' where id = $1", [created.user.id]);
    process.env.INVITE_REQUIRED = "true";
    const linked = await completeGoogleProfile(db, { sub: "sub-admin", email: "admin@pikas.test", emailVerified: true, name: "Admin" }, null);
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    expect(linked.user.id).toBe(created.user.id);
    expect(linked.user.role).toBe("admin");
    const row = await db.query<{ google_sub: string }>("select google_sub from users where id = $1", [created.user.id]);
    expect(row[0]?.google_sub).toBe("sub-admin");
  });
});
