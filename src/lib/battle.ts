import { barriers, resolveBattle, scorePrediction, type BattleCandle } from "../engine/battle";
import type { Db } from "./db";
import { ASSET_SYMBOLS } from "./symbols";
import type { QuoteView } from "./trading";

export async function createBattle(
  db: Db,
  userId: string,
  input: { symbol: string; voteMinutes: number; competeMinutes: number; rewardPct: string; riskPct: string },
  now = Date.now(),
) {
  const reward = Number(input.rewardPct);
  const risk = Number(input.riskPct);
  if (!ASSET_SYMBOLS.includes(input.symbol)) return { ok: false as const, error: "Activo no soportado." };
  if (!(reward > 0 && reward <= 20) || !(risk > 0 && risk <= 20)) return { ok: false as const, error: "Riesgo y objetivo deben estar entre 0 y 20%." };
  if (input.voteMinutes < 5 || input.competeMinutes < 5) return { ok: false as const, error: "Las ventanas mínimas son de 5 minutos." };
  const id = crypto.randomUUID();
  await db.query(
    `insert into battles (id, symbol, status, vote_starts_at, vote_ends_at, ends_at, reward_pct, risk_pct, created_by, created_at)
     values ($1,$2,'voting',$3,$4,$5,$6,$7,$8,$9)`,
    [id, input.symbol, now, now + input.voteMinutes * 60_000, now + (input.voteMinutes + input.competeMinutes) * 60_000, input.rewardPct, input.riskPct, userId, now],
  );
  const users = await db.query<{ id: string }>("select id from users where disabled = 0");
  for (const user of users) {
    await db.query(
      "insert into notifications (id, user_id, category, title, body, created_at) values ($1,$2,'battle','Nueva ronda',$3,$4)",
      [crypto.randomUUID(), user.id, `Market Battle: ${input.symbol}. Votación abierta.`, now],
    );
  }
  return { ok: true as const, id };
}

export async function voteBattle(db: Db, userId: string, battleId: string, direction: "up" | "down", now = Date.now()) {
  const rows = await db.query<{ status: string; vote_ends_at: number }>("select status, vote_ends_at from battles where id = $1", [battleId]);
  const battle = rows[0];
  if (!battle) return { ok: false as const, error: "La ronda no existe." };
  if (battle.status !== "voting" || now > Number(battle.vote_ends_at)) return { ok: false as const, error: "La votación está cerrada." };
  await db.query(
    `insert into battle_votes (battle_id, user_id, direction, created_at, updated_at) values ($1,$2,$3,$4,$4)
     on conflict (battle_id, user_id) do update set direction = excluded.direction, updated_at = excluded.updated_at`,
    [battleId, userId, direction, now],
  );
  return { ok: true as const };
}

export async function listBattles(db: Db, userId: string) {
  const battles = await db.query<Record<string, unknown>>("select * from battles order by created_at desc limit 50");
  const votes = await db.query<{ battle_id: string; direction: string; user_id: string }>("select battle_id, direction, user_id from battle_votes");
  const scores = await db.query<Record<string, unknown>>("select * from battle_scores");
  return battles.map((battle) => {
    const mine = votes.find((vote) => vote.battle_id === battle.id && vote.user_id === userId);
    const related = votes.filter((vote) => vote.battle_id === battle.id);
    const reveal = battle.status !== "voting";
    const up = related.filter((vote) => vote.direction === "up").length;
    return {
      ...battle,
      myVote: mine?.direction ?? null,
      participants: related.length,
      upPct: reveal && related.length ? up / related.length : null,
      downPct: reveal && related.length ? (related.length - up) / related.length : null,
      scores: scores.filter((score) => score.battle_id === battle.id),
      rules: "Acierto por barrera: 100 × (objetivo/riesgo) + hasta 20 por rapidez + 10 de participación. Acierto solo por cierre: 50. Fallo: −40. Si una vela toca ambas barreras, 10 puntos y resultado no verificable.",
    };
  });
}

export async function advanceBattles(db: Db, quotes: QuoteView[], candlesOf: (symbol: string, from: number, to: number) => Promise<BattleCandle[]>, now = Date.now()) {
  const open = await db.query<Record<string, unknown>>("select * from battles where status in ('voting','live')");
  for (const battle of open) {
    const symbol = String(battle.symbol);
    if (battle.status === "voting" && now >= Number(battle.vote_ends_at)) {
      const quote = quotes.find((item) => item.symbol === symbol);
      if (!quote?.executable || !quote.price) {
        if (now > Number(battle.vote_ends_at) + 15 * 60_000) {
          await db.query("update battles set status = 'cancelled', resolution = 'unverifiable', resolution_note = $2, resolved_at = $3 where id = $1", [
            battle.id,
            "No hubo un precio real ejecutable para fijar el inicio.",
            now,
          ]);
        }
        continue;
      }
      await db.query("update battles set status = 'live', start_price = $2, source = $3 where id = $1", [battle.id, quote.price, quote.source]);
      continue;
    }
    if (battle.status === "live" && battle.start_price) {
      const candles = await candlesOf(symbol, Number(battle.vote_ends_at), Number(battle.ends_at));
      const finished = now >= Number(battle.ends_at);
      const preview = resolveBattle({
        startPrice: String(battle.start_price),
        rewardPct: String(battle.reward_pct),
        riskPct: String(battle.risk_pct),
        candles,
        startAt: Number(battle.vote_ends_at),
        endAt: finished ? Number(battle.ends_at) : now,
      });
      const early = preview.kind === "barrier_up" || preview.kind === "barrier_down" || preview.kind === "unverifiable";
      if (!finished && !early) continue;
      if (!finished && preview.kind === "unverifiable" && candles.length === 0) continue;
      await db.query(
        `update battles set status = 'resolved', end_price = $2, high_price = $3, low_price = $4, resolved_at = $5, resolution = $6, resolution_note = $7 where id = $1`,
        [battle.id, preview.endPrice, preview.high, preview.low, preview.resolvedAt, preview.kind, preview.note],
      );
      const votes = await db.query<{ user_id: string; direction: "up" | "down" }>("select user_id, direction from battle_votes where battle_id = $1", [battle.id]);
      for (const vote of votes) {
        const score = scorePrediction({
          direction: vote.direction,
          resolution: preview.kind,
          rewardPct: String(battle.reward_pct),
          riskPct: String(battle.risk_pct),
          startedAt: Number(battle.vote_ends_at),
          resolvedAt: preview.resolvedAt,
          endsAt: Number(battle.ends_at),
        });
        await db.query(
          `insert into battle_scores (battle_id, user_id, points, correct, reason, detail_json) values ($1,$2,$3,$4,$5,$6)
           on conflict (battle_id, user_id) do update set points = excluded.points, correct = excluded.correct, reason = excluded.reason, detail_json = excluded.detail_json`,
          [battle.id, vote.user_id, score.points, score.correct === null ? null : score.correct ? 1 : 0, score.reason, JSON.stringify({ ...score, startPrice: battle.start_price, resolution: preview })],
        );
        await db.query(
          "insert into notifications (id, user_id, category, title, body, created_at) values ($1,$2,'battle','Resultado de Market Battle',$3,$4)",
          [crypto.randomUUID(), vote.user_id, `${symbol}: ${preview.note} Tus puntos: ${score.points}.`, now],
        );
      }
    }
  }
  return barriers("100", "1", "1");
}
