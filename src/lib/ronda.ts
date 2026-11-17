import { arenaSlots } from "./arena";
import { callOneProvider, aiConfigured } from "./ai";
import type { Db } from "./db";
import {
  BOTS,
  COMMUNITY_QUORUM,
  GENESIS_HASH,
  HORIZONS,
  chainHash,
  clockFromEnv,
  contrarioSide,
  dadoSide,
  historyWeight,
  levelsFor,
  openSessions,
  parseAiSide,
  predictionCanonical,
  qualifiesForSeason,
  resolveSide,
  rupturaSide,
  reversionSide,
  teamAverage,
  validateFreeCall,
  verifyLink,
  volatilityLevels,
  versusReference,
  type Horizon,
  type MinuteCandle,
  type Side,
} from "../engine/ronda";

interface RondaRow {
  id: string;
  session_key: string;
  label: string;
  symbol: string;
  status: string;
  vote_opens_at: number;
  starts_at: number;
  ends_at: number;
  entry_price: string | null;
  stop_pct: string | null;
  target_pct: string | null;
  source: string | null;
  resolution: string | null;
  resolution_note: string | null;
  resolved_at: number | null;
}

interface PickRow {
  id: string;
  ronda_id: string;
  actor_type: string;
  actor_id: string;
  display_name: string;
  side: Side;
  rationale: string | null;
  entry_price: string | null;
  stop_price: string | null;
  target_price: string | null;
  points: string | null;
  outcome: string | null;
  hash: string | null;
  created_at: number;
}

async function appendProof(db: Db, input: { kind: string; refId: string; canonical: string; createdAt: number }): Promise<string> {
  const prevRows = await db.query<{ hash: string; seq: number }>("select hash, seq from proof_chain order by seq desc limit 1");
  const prev = prevRows[0]?.hash || GENESIS_HASH;
  const seq = Number(prevRows[0]?.seq || 0) + 1;
  const hash = chainHash(prev, input.canonical);
  await db.query(
    `insert into proof_chain (id, seq, prev_hash, hash, canonical, kind, ref_id, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [crypto.randomUUID(), seq, prev, hash, input.canonical, input.kind, input.refId, input.createdAt],
  );
  return hash;
}

async function rateOk(db: Db, key: string, limit: number, windowMs: number, now: number): Promise<boolean> {
  const rows = await db.query<{ window_start: number; count: number }>("select window_start, count from rate_limits where key = $1", [key]);
  const row = rows[0];
  if (!row || now - Number(row.window_start) >= windowMs) {
    await db.query(
      `insert into rate_limits (key, window_start, count) values ($1,$2,1)
       on conflict (key) do update set window_start = excluded.window_start, count = 1`,
      [key, now],
    );
    return true;
  }
  if (Number(row.count) >= limit) return false;
  await db.query("update rate_limits set count = count + 1 where key = $1", [key]);
  return true;
}

export async function castRondaVote(db: Db, userId: string, username: string, rondaId: string, side: Side, now = Date.now()) {
  if (!(await rateOk(db, `ronda:${userId}`, 30, 10 * 60_000, now))) {
    return { ok: false as const, error: "Demasiados cambios de voto. Espera unos minutos." };
  }
  const rows = await db.query<RondaRow>("select * from rondas where id = $1", [rondaId]);
  const ronda = rows[0];
  if (!ronda) return { ok: false as const, error: "Esa ronda no existe." };
  if (ronda.status !== "voting" || now >= Number(ronda.starts_at)) return { ok: false as const, error: "La votación ya está cerrada." };
  const existing = await db.query<PickRow>(
    "select * from ronda_picks where ronda_id = $1 and actor_type = 'user' and actor_id = $2",
    [rondaId, userId],
  );
  const id = existing[0]?.id || crypto.randomUUID();
  const canonical = predictionCanonical({
    id,
    kind: existing[0] ? "enmienda" : "voto",
    actor: `user:${userId}`,
    side,
    entry: "pendiente",
    stop: "pendiente",
    target: "pendiente",
    createdAt: now,
  });
  const hash = await appendProof(db, { kind: existing[0] ? "enmienda" : "voto", refId: id, canonical, createdAt: now });
  if (existing[0]) {
    await db.query("update ronda_picks set side = $1, hash = $2, updated_at = $3 where id = $4", [side, hash, now, id]);
  } else {
    await db.query(
      `insert into ronda_picks (id, ronda_id, actor_type, actor_id, display_name, side, rationale, hash, created_at, updated_at)
       values ($1,$2,'user',$3,$4,$5,null,$6,$7,$7)`,
      [id, rondaId, userId, username, side, hash, now],
    );
  }
  return { ok: true as const };
}

export async function createFreeCall(
  db: Db,
  userId: string,
  input: { symbol: string; side: Side; entry: string; stop: string; target: string; horizon: Horizon; source: string | null },
  now = Date.now(),
) {
  if (!(await rateOk(db, `libre:${userId}`, 20, 60 * 60_000, now))) {
    return { ok: false as const, error: "Has abierto demasiadas llamadas libres en la última hora." };
  }
  const check = validateFreeCall(input);
  if (!check.ok) return check;
  const id = crypto.randomUUID();
  const canonical = predictionCanonical({
    id,
    kind: "libre",
    actor: `user:${userId}`,
    side: input.side,
    entry: input.entry,
    stop: input.stop,
    target: input.target,
    createdAt: now,
  });
  const hash = await appendProof(db, { kind: "libre", refId: id, canonical, createdAt: now });
  await db.query(
    `insert into free_calls (id, user_id, symbol, side, entry_price, stop_price, target_price, horizon, starts_at, ends_at, status, source, hash, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'live',$11,$12,$13)`,
    [id, userId, input.symbol, input.side, input.entry, input.stop, input.target, input.horizon, now, now + HORIZONS[input.horizon], input.source, hash, now],
  );
  return { ok: true as const, id, hash };
}

async function weights(db: Db, userIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!userIds.length) return map;
  const rows = await db.query<{ actor_id: string; points: string }>(
    "select actor_id, points from ronda_picks where actor_type = 'user' and points is not null",
  );
  for (const userId of userIds) {
    const mine = rows.filter((row) => row.actor_id === userId);
    const wins = mine.filter((row) => Number(row.points) > 0).length;
    map.set(userId, historyWeight(mine.length, wins));
  }
  return map;
}

export async function rondaView(db: Db, userId: string | null) {
  const rondas = await db.query<RondaRow>("select * from rondas order by starts_at desc limit 12");
  const picks = await db.query<PickRow>("select * from ronda_picks where ronda_id in (select id from rondas order by starts_at desc limit 12)");
  const weight = await weights(db, picks.filter((pick) => pick.actor_type === "user").map((pick) => pick.actor_id));
  return rondas.map((ronda) => {
    const mine = picks.filter((pick) => pick.ronda_id === ronda.id);
    const community = mine.filter((pick) => pick.actor_type === "user");
    const reveal = ronda.status !== "voting";
    return {
      ...ronda,
      mine: userId ? community.find((pick) => pick.actor_id === userId) || null : null,
      votes: reveal ? community.length : null,
      up: reveal ? community.filter((pick) => pick.side === "up").length : null,
      teams: reveal
        ? {
            comunidad: teamAverage(community.map((pick) => ({ points: pick.points, weight: weight.get(pick.actor_id) || 1 })), COMMUNITY_QUORUM),
            ia: teamAverage(mine.filter((pick) => pick.actor_type === "ia").map((pick) => ({ points: pick.points, weight: 1 }))),
            bots: teamAverage(mine.filter((pick) => pick.actor_type === "bot").map((pick) => ({ points: pick.points, weight: 1 }))),
            quorum: COMMUNITY_QUORUM,
          }
        : null,
      picks: reveal ? mine : community.filter((pick) => pick.actor_id === userId),
    };
  });
}

async function lockRonda(
  db: Db,
  ronda: RondaRow,
  quote: { price: string; source: string },
  candles: MinuteCandle[],
  askAi: (slot: { name: string; provider: string; model: string; slug: string }, prompt: string) => Promise<{ side: Side; reason: string } | null>,
  now: number,
) {
  const levels = volatilityLevels(quote.price, candles.filter((candle) => candle.ts < Number(ronda.starts_at)));
  if (!levels) {
    if (now > Number(ronda.starts_at) + 15 * 60_000) {
      await db.query("update rondas set status = 'cancelled', resolution = 'unverifiable', resolution_note = $2, resolved_at = $3 where id = $1", [
        ronda.id,
        "No hay suficientes velas de 1 min para calcular el stop. La ronda no se resuelve con un nivel inventado.",
        now,
      ]);
    }
    return;
  }
  await db.query(
    "update rondas set status = 'live', entry_price = $2, stop_pct = $3, target_pct = $4, source = $5 where id = $1",
    [ronda.id, quote.price, levels.stopPct, levels.targetPct, quote.source],
  );
  const humans = await db.query<PickRow>("select * from ronda_picks where ronda_id = $1 and actor_type = 'user'", [ronda.id]);
  for (const pick of humans) {
    const prices = levelsFor(quote.price, levels.stopPct, pick.side);
    const canonical = predictionCanonical({
      id: pick.id,
      kind: "niveles",
      actor: `user:${pick.actor_id}`,
      side: pick.side,
      entry: quote.price,
      stop: prices.stop,
      target: prices.target,
      createdAt: now,
    });
    const hash = await appendProof(db, { kind: "niveles", refId: pick.id, canonical, createdAt: now });
    await db.query(
      "update ronda_picks set entry_price = $2, stop_price = $3, target_price = $4, hash = $5, updated_at = $6 where id = $1",
      [pick.id, quote.price, prices.stop, prices.target, hash, now],
    );
  }
  const closes = candles.filter((candle) => candle.ts < Number(ronda.starts_at)).sort((a, b) => a.ts - b.ts).map((candle) => candle.close);
  const sides: Record<string, Side | null> = {
    dado: dadoSide(ronda.id),
    contra: contrarioSide(humans.map((pick) => pick.side)),
    rompe: rupturaSide(closes),
    vuelta: reversionSide(closes),
  };
  const reasons: Record<string, string> = {
    dado: "Lado fijo a partir del identificador de la ronda. Sirve de referencia, no de pronóstico.",
    contra: "Lado contrario a la mayoría de votos humanos en el cierre de la votación. Si hay empate, no juega.",
    rompe: "Solo entra si el último cierre rompe el máximo o el mínimo de las cinco velas anteriores.",
    vuelta: "Solo entra si el último cierre se aleja más de un 0,1% de la media reciente, hacia el lado contrario.",
  };
  for (const bot of BOTS) {
    const side = sides[bot.id];
    if (!side) continue;
    const prices = levelsFor(quote.price, levels.stopPct, side);
    const id = crypto.randomUUID();
    const canonical = predictionCanonical({
      id,
      kind: "bot",
      actor: `bot:${bot.id}`,
      side,
      entry: quote.price,
      stop: prices.stop,
      target: prices.target,
      createdAt: now,
    });
    const hash = await appendProof(db, { kind: "bot", refId: id, canonical, createdAt: now });
    await db.query(
      `insert into ronda_picks (id, ronda_id, actor_type, actor_id, display_name, side, rationale, entry_price, stop_price, target_price, hash, created_at, updated_at)
       values ($1,$2,'bot',$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
      [id, ronda.id, bot.id, bot.name, side, reasons[bot.id], quote.price, prices.stop, prices.target, hash, now],
    );
  }
  const prompt = `Eres un participante de una simulación educativa, no das consejo financiero. Responde solo JSON {"side":"up"|"down","reason":"..."}. Entrada ${quote.price} (${quote.source}). Stop ${levels.stopPct}%. Objetivo ${levels.targetPct}%. Si no tienes un lado claro, responde {"side":"","reason":""}.`;
  for (const slot of arenaSlots().filter((item) => item.configured).slice(0, 6)) {
    const answer = await askAi(slot, prompt);
    if (!answer) continue;
    const prices = levelsFor(quote.price, levels.stopPct, answer.side);
    const id = crypto.randomUUID();
    const canonical = predictionCanonical({
      id,
      kind: "ia",
      actor: `ia:${slot.slug}`,
      side: answer.side,
      entry: quote.price,
      stop: prices.stop,
      target: prices.target,
      createdAt: now,
    });
    const hash = await appendProof(db, { kind: "ia", refId: id, canonical, createdAt: now });
    await db.query(
      `insert into ronda_picks (id, ronda_id, actor_type, actor_id, display_name, side, rationale, entry_price, stop_price, target_price, hash, created_at, updated_at)
       values ($1,$2,'ia',$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
      [id, ronda.id, slot.slug, slot.name, answer.side, answer.reason, quote.price, prices.stop, prices.target, hash, now],
    );
  }
}

async function settleRonda(db: Db, ronda: RondaRow, candles: MinuteCandle[], now: number) {
  const picks = await db.query<PickRow>("select * from ronda_picks where ronda_id = $1", [ronda.id]);
  let note = "Resuelta con velas de 1 min.";
  for (const pick of picks) {
    if (!pick.entry_price || !pick.stop_price || !pick.target_price) continue;
    const result = resolveSide({
      side: pick.side,
      entry: pick.entry_price,
      stop: pick.stop_price,
      target: pick.target_price,
      candles,
      startAt: Number(ronda.starts_at),
      endAt: Number(ronda.ends_at),
    });
    note = result.note;
    await db.query("update ronda_picks set points = $2, outcome = $3, updated_at = $4 where id = $1", [pick.id, result.points, result.outcome, now]);
  }
  const unverifiable = picks.length > 0 && (await db.query("select id from ronda_picks where ronda_id = $1 and outcome = 'unverifiable'", [ronda.id])).length === picks.length;
  await db.query("update rondas set status = $2, resolution = $3, resolution_note = $4, resolved_at = $5 where id = $1", [
    ronda.id,
    unverifiable ? "cancelled" : "resolved",
    unverifiable ? "unverifiable" : "settled",
    note,
    now,
  ]);
}

async function defaultAsk(slot: { provider: string; model: string }, prompt: string) {
  const result = await callOneProvider({
    provider: slot.provider,
    model: slot.model,
    messages: [
      { role: "system", content: "Responde únicamente con el JSON pedido. Simulación educativa." },
      { role: "user", content: prompt },
    ],
  });
  if (!result.ok) return null;
  return parseAiSide(result.content);
}

export async function tickRondas(
  db: Db,
  input: {
    now?: number;
    quote: { price: string; source: string; executable: boolean } | null;
    candles: MinuteCandle[];
    symbol?: string;
    askAi?: (slot: { name: string; provider: string; model: string; slug: string }, prompt: string) => Promise<{ side: Side; reason: string } | null>;
  },
) {
  const now = input.now ?? Date.now();
  const symbol = input.symbol || process.env.PIKAS_RONDA_SYMBOL || "BTC";
  const ask = input.askAi || (async (slot, prompt) => defaultAsk(slot, prompt));
  for (const session of openSessions(now)) {
    const found = await db.query<RondaRow>("select * from rondas where session_key = $1", [session.key]);
    if (found[0]) continue;
    await db.query(
      `insert into rondas (id, session_key, label, symbol, status, vote_opens_at, starts_at, ends_at, created_at)
       values ($1,$2,$3,$4,'voting',$5,$6,$7,$8)`,
      [crypto.randomUUID(), session.key, session.label, symbol, session.voteOpensAt, session.startsAt, session.endsAt, now],
    );
  }
  const pending = await db.query<RondaRow>("select * from rondas where status in ('voting','live')");
  for (const ronda of pending) {
    if (ronda.status === "voting" && now >= Number(ronda.starts_at)) {
      if (!input.quote?.executable) {
        if (now > Number(ronda.starts_at) + 15 * 60_000) {
          await db.query("update rondas set status = 'cancelled', resolution = 'unverifiable', resolution_note = $2, resolved_at = $3 where id = $1", [
            ronda.id,
            "No había un precio ejecutable al empezar. No se finge la entrada.",
            now,
          ]);
        }
      } else {
        await lockRonda(db, ronda, { price: input.quote.price, source: input.quote.source }, input.candles, ask, now);
      }
    }
    if (ronda.status === "live" && now >= Number(ronda.ends_at)) {
      await settleRonda(db, ronda, input.candles, now);
    }
  }
  await settleFree(db, symbol, input.candles, now);
}

export async function dueFreeSymbols(db: Db, now: number): Promise<string[]> {
  const rows = await db.query<{ symbol: string }>("select distinct symbol from free_calls where status = 'live' and ends_at <= $1", [now]);
  return rows.map((row) => row.symbol);
}

export async function settleFree(db: Db, symbol: string, candles: MinuteCandle[], now: number) {
  const due = await db.query<{
    id: string;
    symbol: string;
    side: Side;
    entry_price: string;
    stop_price: string;
    target_price: string;
    starts_at: number;
    ends_at: number;
  }>("select * from free_calls where status = 'live' and ends_at <= $1 and symbol = $2", [now, symbol]);
  for (const call of due) {
    const result = resolveSide({
      side: call.side,
      entry: call.entry_price,
      stop: call.stop_price,
      target: call.target_price,
      candles: candles.filter(() => true),
      startAt: Number(call.starts_at),
      endAt: Number(call.ends_at),
    });
    await db.query("update free_calls set status = $2, resolution = $3, points = $4, note = $5, resolved_at = $6 where id = $1", [
      call.id,
      result.outcome === "unverifiable" ? "cancelled" : "resolved",
      result.outcome,
      result.points,
      result.note,
      now,
    ]);
  }
}

function monthKey(now: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.PIKAS_TZ || "Europe/Madrid", year: "numeric", month: "2-digit" }).format(now);
  return parts.slice(0, 7);
}

export async function seasonBoard(db: Db, now = Date.now()) {
  const key = monthKey(now);
  const [year, month] = key.split("-").map(Number);
  const start = Date.UTC(year, month - 1, 1);
  const end = Date.UTC(year, month, 1);
  const picks = await db.query<PickRow & { starts_at: number }>(
    `select p.*, r.starts_at from ronda_picks p join rondas r on r.id = p.ronda_id
     where p.points is not null and r.starts_at >= $1 and r.starts_at < $2`,
    [start, end],
  );
  const dado = picks.filter((pick) => pick.actor_type === "bot" && pick.actor_id === "dado");
  const dadoPoints = dado.reduce((sum, pick) => sum + Number(pick.points), 0);
  const byUser = new Map<string, { name: string; rounds: number; points: number }>();
  for (const pick of picks.filter((item) => item.actor_type === "user")) {
    const current = byUser.get(pick.actor_id) || { name: pick.display_name, rounds: 0, points: 0 };
    current.rounds += 1;
    current.points += Number(pick.points);
    byUser.set(pick.actor_id, current);
  }
  const rows = [...byUser.entries()].map(([id, row]) => ({
    id,
    name: row.name,
    rounds: row.rounds,
    points: row.points.toFixed(4),
    qualifies: qualifiesForSeason(row.rounds),
    versus: qualifiesForSeason(row.rounds) ? versusReference(row.points.toFixed(4), dado.length ? dadoPoints.toFixed(4) : null) : "sin_referencia",
  }));
  return { month: key, minimum: 10, reference: "Dado ciego", referencePoints: dado.length ? dadoPoints.toFixed(4) : null, rows };
}

export async function castPoll(db: Db, userId: string, choice: "comunidad" | "ia" | "bots", now = Date.now()) {
  const current = monthKey(now);
  const [year, month] = current.split("-").map(Number);
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  await db.query(
    `insert into month_poll (user_id, month_key, choice, created_at) values ($1,$2,$3,$4)
     on conflict (user_id, month_key) do update set choice = excluded.choice, created_at = excluded.created_at`,
    [userId, next, choice, now],
  );
  return { ok: true as const, month: next };
}

export async function pollTally(db: Db, now = Date.now()) {
  const current = monthKey(now);
  const [year, month] = current.split("-").map(Number);
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  const rows = await db.query<{ choice: string; count: number }>(
    "select choice, count(*)::int as count from month_poll where month_key = $1 group by choice",
    [next],
  );
  return { month: next, votes: rows };
}

export async function readSentiment(db: Db) {
  const rows = await db.query("select * from sentiment_cache where id = 'fng'");
  return rows[0] || null;
}

export async function refreshSentiment(db: Db, fetchImpl: typeof fetch = fetch, now = Date.now()) {
  const current = await db.query<{ fetched_at: number }>("select fetched_at from sentiment_cache where id = 'fng'");
  if (current[0] && now - Number(current[0].fetched_at) < 60 * 60_000) return;
  try {
    const response = await fetchImpl("https://api.alternative.me/fng/?limit=1", { cache: "no-store" });
    if (!response.ok) throw new Error(`alternative.me respondió ${response.status}`);
    const payload = (await response.json()) as { data?: Array<{ value?: string; value_classification?: string }> };
    const value = Number(payload.data?.[0]?.value);
    const label = payload.data?.[0]?.value_classification || "";
    if (!Number.isFinite(value)) throw new Error("alternative.me no trajo un valor");
    await db.query(
      `insert into sentiment_cache (id, value, label, source, fetched_at, status, detail) values ('fng',$1,$2,'alternative.me',$3,'live',null)
       on conflict (id) do update set value = excluded.value, label = excluded.label, fetched_at = excluded.fetched_at, status = 'live', detail = null`,
      [value, label, now],
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error";
    await db.query(
      `insert into sentiment_cache (id, value, label, source, fetched_at, status, detail) values ('fng',null,null,'alternative.me',$1,'error',$2)
       on conflict (id) do update set fetched_at = excluded.fetched_at, status = 'error', detail = excluded.detail`,
      [now, detail.slice(0, 240)],
    );
  }
}

export async function maybeDailyBrief(db: Db, now = Date.now()) {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.PIKAS_TZ || "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const existing = await db.query("select day_key from daily_briefs where day_key = $1", [key]);
  if (existing.length) return;
  const resolved = await db.query<{ label: string; resolution: string | null }>(
    "select label, resolution from rondas where resolved_at is not null and resolved_at > $1 order by resolved_at desc limit 6",
    [now - 36 * 60 * 60_000],
  );
  const facts = resolved.length
    ? resolved.map((row) => `${row.label}: ${row.resolution || "sin resolución"}`).join(". ")
    : "No hay rondas resueltas guardadas en las últimas 36 horas.";
  if (!aiConfigured()) {
    await db.query("insert into daily_briefs (day_key, body, source, created_at) values ($1,$2,'not_configured',$3)", [
      key,
      `PIKAS AI no configurado. No hay resumen generado. Datos guardados: ${facts}`,
      now,
    ]);
    return;
  }
  const slot = arenaSlots().find((item) => item.configured);
  const answer = slot
    ? await callOneProvider({
        provider: slot.provider,
        model: slot.model,
        messages: [{ role: "user", content: `Resume en español, en un párrafo corto, solo estos datos ya guardados. No añadas cifras que no estén aquí. ${facts}` }],
      })
    : { ok: false as const, error: "sin motor", code: "not_configured" as const };
  const text = answer.ok ? answer.content.trim().slice(0, 1200) : "";
  await db.query("insert into daily_briefs (day_key, body, source, created_at) values ($1,$2,$3,$4)", [
    key,
    text ? `Generado por PIKAS AI solo con datos guardados. ${text}` : `PIKAS AI no respondió. No se inventa el resumen. Datos guardados: ${facts}`,
    text ? "pikas_ai" : "ai_failed",
    now,
  ]);
}

export async function latestBrief(db: Db) {
  const rows = await db.query("select * from daily_briefs order by day_key desc limit 1");
  return rows[0] || null;
}

export async function chainExport(db: Db) {
  const rows = await db.query<{ prev_hash: string; hash: string; canonical: string; kind: string; created_at: number }>(
    "select prev_hash, hash, canonical, kind, created_at from proof_chain order by seq asc",
  );
  let prev = GENESIS_HASH;
  const checked = rows.map((row) => {
    const ok = row.prev_hash === prev && verifyLink(row.prev_hash, row.canonical, row.hash);
    prev = row.hash;
    return { ...row, ok };
  });
  return { genesis: GENESIS_HASH, intact: checked.every((row) => row.ok), rows: checked };
}

export async function verifyHash(db: Db, hash: string) {
  const chain = await chainExport(db);
  const row = chain.rows.find((item) => item.hash === hash);
  return { found: Boolean(row), intact: chain.intact, row: row || null, genesis: GENESIS_HASH };
}
