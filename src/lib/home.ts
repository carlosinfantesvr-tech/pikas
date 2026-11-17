import { providerInfos } from "./ai";
import type { Db } from "./db";
import { badgesFor, challengeDone, compareSides, dailyChallenge, levelFromXp, streakFromDays, xpFrom, type ProgressFacts } from "../engine/progress";
import { clockFromEnv, openSessions, sessionsOn } from "../engine/ronda";
import { ASSET_SYMBOLS } from "./symbols";

function madridKey(now: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.PIKAS_TZ || "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function nextStart(now: number): { label: string; startsAt: number; phase: string } | null {
  const clock = clockFromEnv();
  const open = openSessions(now, clock);
  const voting = open.find((slot) => slot.phase === "voting");
  if (voting) return { label: voting.label, startsAt: voting.startsAt, phase: "voting" };
  const live = open.find((slot) => slot.phase === "live");
  if (live) return { label: live.label, startsAt: live.endsAt, phase: "live" };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: clock.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [year, month, day] = today.split("-").map(Number);
  const upcoming = [0, 1, 2]
    .flatMap((delta) => {
      const date = new Date(Date.UTC(year, month - 1, day + delta));
      return sessionsOn(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), clock);
    })
    .filter((slot) => slot.startsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt)[0];
  return upcoming ? { label: upcoming.label, startsAt: upcoming.startsAt, phase: "upcoming" } : null;
}

export async function activityFeed(db: Db, userId: string) {
  const orders = await db.query<{ symbol: string; side: string; status: string; created_at: number }>(
    `select o.symbol, o.side, o.status, o.created_at from orders o
     join accounts a on a.id = o.account_id
     where a.owner_id = $1 order by o.created_at desc limit 6`,
    [userId],
  );
  const votes = await db.query<{ side: string; created_at: number; label: string }>(
    `select p.side, p.created_at, r.label from ronda_picks p join rondas r on r.id = p.ronda_id
     where p.actor_type = 'user' and p.actor_id = $1 order by p.created_at desc limit 6`,
    [userId],
  );
  const resolved = await db.query<{ label: string; resolution: string | null; resolved_at: number }>(
    "select label, resolution, resolved_at from rondas where status in ('resolved','cancelled') and resolved_at is not null order by resolved_at desc limit 4",
  );
  const items = [
    ...orders.map((row) => ({ kind: "orden", text: `${row.side} ${row.symbol} · ${row.status}`, at: Number(row.created_at) })),
    ...votes.map((row) => ({ kind: "voto", text: `${row.label}: ${row.side === "up" ? "sube" : "baja"}`, at: Number(row.created_at) })),
    ...resolved.map((row) => ({ kind: "ronda", text: `${row.label} · ${row.resolution || "resuelta"}`, at: Number(row.resolved_at) })),
  ];
  return items.sort((a, b) => b.at - a.at).slice(0, 8);
}

export async function sparks(db: Db, symbols: string[]) {
  const out: Array<{ symbol: string; closes: number[] }> = [];
  for (const symbol of symbols.slice(0, 6)) {
    const rows = await db.query<{ close: string }>(
      "select close from candles where symbol = $1 and interval = '1h' order by ts desc limit 24",
      [symbol],
    );
    if (rows.length < 2) continue;
    out.push({ symbol, closes: rows.map((row) => Number(row.close)).reverse() });
  }
  return out;
}

async function factsFor(db: Db, userId: string, now: number): Promise<ProgressFacts & { votedToday: boolean; dayKeys: string[] }> {
  const account = await db.query<{ id: string }>("select id from accounts where owner_type = 'user' and owner_id = $1 limit 1", [userId]);
  const accountId = account[0]?.id;
  const trades = accountId
    ? await db.query<{ closed_at: number; realized_pnl: string }>("select closed_at, realized_pnl from trades where account_id = $1", [accountId])
    : [];
  const votes = await db.query<{ created_at: number }>("select created_at from ronda_picks where actor_type = 'user' and actor_id = $1", [userId]);
  const resolved = await db.query<{ id: string }>(
    `select p.id from ronda_picks p join rondas r on r.id = p.ronda_id
     where p.actor_type = 'user' and p.actor_id = $1 and p.points is not null`,
    [userId],
  );
  const free = await db.query<{ id: string }>("select id from free_calls where user_id = $1", [userId]);
  const dayKeys = [...trades.map((row) => madridKey(Number(row.closed_at))), ...votes.map((row) => madridKey(Number(row.created_at)))];
  const today = madridKey(now);
  return {
    trades: trades.length,
    wins: trades.filter((row) => Number(row.realized_pnl) > 0).length,
    votes: votes.length,
    resolvedRounds: resolved.length,
    freeCalls: free.length,
    streakDays: streakFromDays(dayKeys, today),
    votedToday: votes.some((row) => madridKey(Number(row.created_at)) === today),
    dayKeys,
  };
}

export async function progressView(db: Db, userId: string, now = Date.now()) {
  const facts = await factsFor(db, userId, now);
  const settings = await db.query<{ favorites: string | null }>("select favorites from user_settings where user_id = $1", [userId]);
  const openedChart = (settings[0]?.favorites || "").length > 0;
  const comparedRows = await db.query<{ ronda_id: string; actor_type: string; actor_id: string; points: string }>(
    `select p.ronda_id, p.actor_type, p.actor_id, p.points from ronda_picks p
     where p.points is not null and p.ronda_id in (
       select ronda_id from ronda_picks where actor_type = 'user' and actor_id = $1 and points is not null
     )`,
    [userId],
  );
  const compared = compareSides(
    comparedRows.map((row) => ({ actor: `${row.ronda_id}|${row.actor_type}:${row.actor_id}`, points: Number(row.points) })),
    userId,
  );
  const today = madridKey(now);
  const challenge = dailyChallenge(today);
  const done = challengeDone(challenge.id, { votedToday: facts.votedToday, openedChart, compared: compared.length > 0 });
  const xp = xpFrom(facts);
  return {
    xp,
    level: levelFromXp(xp),
    badges: badgesFor(facts),
    streakDays: facts.streakDays,
    challenge: { ...challenge, done },
    compare: compared.map((row) => ({ ...row, name: row.actor.replace(/^ia:/, "").replace(/^bot:/, "") })),
  };
}

export async function homePayload(db: Db, userId: string, favoriteSymbols: string[]) {
  const symbols = favoriteSymbols.length ? favoriteSymbols : ["BTC", "ETH", "SOL"];
  return {
    activity: await activityFeed(db, userId),
    sparks: await sparks(db, symbols.filter((symbol) => ASSET_SYMBOLS.includes(symbol))),
    next: nextStart(Date.now()),
    progress: await progressView(db, userId),
  };
}

export async function iaBoard(db: Db) {
  const picks = await db.query<{ actor_id: string; points: string | null }>(
    "select actor_id, points from ronda_picks where actor_type = 'ia'",
  );
  return providerInfos().map((provider) => {
    const rows = picks.filter((pick) => pick.actor_id.startsWith(provider.id));
    const scored = rows.filter((pick) => pick.points != null);
    const points = scored.reduce((sum, pick) => sum + Number(pick.points), 0);
    return {
      id: provider.id,
      label: provider.label,
      configured: provider.configured,
      free: provider.free,
      picks: rows.length,
      scored: scored.length,
      points: scored.length ? points.toFixed(4) : null,
    };
  });
}

export function parseFavorites(value: string | null | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => ASSET_SYMBOLS.includes(item));
}
