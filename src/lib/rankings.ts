import { accountEquity, unrealizedPnl } from "../engine/trading";
import { compositeScore, maxDrawdown } from "../engine/rank";
import type { Db } from "./db";
import type { QuoteView } from "./trading";

export async function paperRankings(db: Db, quotes: QuoteView[]) {
  const accounts = await db.query<Record<string, unknown>>("select * from accounts where status = 'active' and owner_type = 'user'");
  const rows = [];
  for (const account of accounts) {
    const positions = await db.query<Record<string, unknown>>("select * from positions where account_id = $1 and status = 'open'", [account.id]);
    const trades = await db.query<Record<string, unknown>>("select realized_pnl, fee from trades where account_id = $1", [account.id]);
    const snaps = await db.query<{ equity: string }>("select equity from equity_snapshots where account_id = $1 order by ts asc", [account.id]);
    const marks: Record<string, string> = {};
    let stale = false;
    for (const position of positions) {
      const quote = quotes.find((item) => item.symbol === position.symbol);
      if (quote?.price && quote.executable) marks[String(position.symbol)] = quote.price;
      else stale = true;
    }
    const snap = {
      balance: String(account.balance),
      orders: [],
      positions: positions.map((position) => ({
        id: String(position.id),
        symbol: String(position.symbol),
        side: position.side as "long" | "short",
        qty: String(position.qty),
        entryPrice: String(position.entry_price),
        margin: String(position.margin),
        leverage: Number(position.leverage),
        realizedPnl: String(position.realized_pnl),
        fees: String(position.fees),
        funding: String(position.funding),
        openedAt: Number(position.opened_at),
        tp: null,
        sl: null,
      })),
    };
    const equity = accountEquity(snap, marks);
    const initial = Number(account.initial_balance);
    const equityNum = Number(equity);
    const closed = trades.length;
    const wins = trades.filter((trade) => Number(trade.realized_pnl) - Number(trade.fee) > 0).length;
    const dd = maxDrawdown(snaps.map((snapRow) => Number(snapRow.equity)));
    const upnl = positions.reduce((sum, position) => {
      const mark = marks[String(position.symbol)];
      if (!mark) return sum;
      return sum + Number(unrealizedPnl(snap.positions.find((item) => item.id === position.id)!, mark));
    }, 0);
    rows.push({
      accountId: account.id,
      ownerId: account.owner_id,
      initialBalance: String(account.initial_balance),
      equity,
      returnPct: initial ? (equityNum - initial) / initial : null,
      pnl: equityNum - initial,
      unrealized: stale ? null : upnl,
      winRate: closed ? wins / closed : null,
      drawdown: dd,
      trades: closed,
      valuation: stale ? "parcial: alguna marca no es ejecutable y no entra en el patrimonio" : "en vivo",
    });
  }
  const users = await db.query<{ id: string; username: string; avatar_hue: number }>("select id, username, avatar_hue from users");
  return rows
    .map((row) => ({ ...row, user: users.find((user) => user.id === row.ownerId) || null }))
    .sort((a, b) => (b.returnPct ?? -999) - (a.returnPct ?? -999))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export async function battleRankings(db: Db, since: number | null) {
  const scores = await db.query<Record<string, unknown>>(
    since
      ? `select s.*, b.resolved_at from battle_scores s join battles b on b.id = s.battle_id where b.resolved_at >= $1`
      : `select s.*, b.resolved_at from battle_scores s join battles b on b.id = s.battle_id`,
    since ? [since] : [],
  );
  const users = await db.query<{ id: string; username: string; avatar_hue: number }>("select id, username, avatar_hue from users");
  const map = new Map<string, { points: number; rounds: number }>();
  for (const score of scores) {
    const current = map.get(String(score.user_id)) || { points: 0, rounds: 0 };
    current.points += Number(score.points);
    current.rounds += 1;
    map.set(String(score.user_id), current);
  }
  return [...map.entries()]
    .map(([userId, value]) => ({ userId, ...value, user: users.find((user) => user.id === userId) || null }))
    .sort((a, b) => b.points - a.points)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export async function arenaRankings(db: Db) {
  const agents = await db.query<Record<string, unknown>>("select * from agents");
  const rows = [];
  for (const agent of agents) {
    if (!agent.account_id) {
      rows.push({ agent, returnPct: null, winRate: null, trades: 0, drawdown: null, score: null, reason: "Sin cuenta todavía." });
      continue;
    }
    const accounts = await db.query<Record<string, unknown>>("select * from accounts where id = $1", [agent.account_id]);
    const account = accounts[0];
    if (!account) continue;
    const trades = await db.query<Record<string, unknown>>("select realized_pnl, fee from trades where account_id = $1", [account.id]);
    const snaps = await db.query<{ equity: string }>("select equity from equity_snapshots where account_id = $1 order by ts asc", [account.id]);
    const initial = Number(account.initial_balance);
    const equity = Number(account.balance);
    const returnPct = initial ? (equity - initial) / initial : null;
    const wins = trades.filter((trade) => Number(trade.realized_pnl) - Number(trade.fee) > 0).length;
    const winRate = trades.length ? wins / trades.length : null;
    const drawdown = maxDrawdown(snaps.map((snap) => Number(snap.equity)));
    const scored = compositeScore({ returnPct, winRate, closedTrades: trades.length, maxDrawdownPct: drawdown });
    rows.push({
      agent,
      equity: account.balance,
      initialBalance: account.initial_balance,
      returnPct,
      winRate,
      trades: trades.length,
      drawdown,
      score: scored.score,
      reason: scored.reason,
    });
  }
  return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}
