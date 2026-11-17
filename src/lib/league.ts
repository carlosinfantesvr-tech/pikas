import { randomBytes } from "crypto";
import { rankLeague } from "../engine/league";
import { sha256 } from "./auth";
import type { Db } from "./db";
import { notifyOnce } from "./notify";

export async function createLeague(db: Db, ownerId: string, name: string) {
  const clean = name.trim().slice(0, 40);
  if (clean.length < 3) return { ok: false as const, error: "El nombre de la liga necesita al menos 3 caracteres." };
  const code = randomBytes(4).toString("hex");
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.query("insert into leagues (id, name, code_hash, owner_id, created_at) values ($1,$2,$3,$4,$5)", [id, clean, sha256(code), ownerId, now]);
  await db.query("insert into league_members (league_id, user_id, joined_at) values ($1,$2,$3)", [id, ownerId, now]);
  return { ok: true as const, id, code, name: clean };
}

export async function joinLeague(db: Db, userId: string, username: string, code: string) {
  const rows = await db.query<{ id: string; name: string; owner_id: string }>("select id, name, owner_id from leagues where code_hash = $1", [sha256(code.trim().toLowerCase())]);
  const league = rows[0];
  if (!league) return { ok: false as const, error: "Ese código no corresponde a ninguna liga." };
  await db.query(
    "insert into league_members (league_id, user_id, joined_at) values ($1,$2,$3) on conflict (league_id, user_id) do nothing",
    [league.id, userId, Date.now()],
  );
  if (league.owner_id !== userId) {
    await notifyOnce(db, league.owner_id, "liga", `${username} entró en ${league.name}`, `${username} se unió a tu liga con el código.`);
  }
  return { ok: true as const, id: league.id, name: league.name };
}

export async function listLeagues(db: Db, userId: string) {
  const rows = await db.query<{ id: string; name: string; owner_id: string; joined_at: number }>(
    `select l.id, l.name, l.owner_id, m.joined_at from leagues l
     join league_members m on m.league_id = l.id
     where m.user_id = $1 order by m.joined_at desc`,
    [userId],
  );
  return rows;
}

export async function leagueBoard(db: Db, userId: string, leagueId: string) {
  const member = await db.query("select user_id from league_members where league_id = $1 and user_id = $2", [leagueId, userId]);
  if (!member.length) return { ok: false as const, error: "No estás en esa liga." };
  const people = await db.query<{ user_id: string; username: string; equity: string | null; initial: string | null }>(
    `select u.id as user_id, u.username, a.balance as equity, a.initial_balance as initial
     from league_members m
     join users u on u.id = m.user_id
     left join accounts a on a.owner_type = 'user' and a.owner_id = u.id
     where m.league_id = $1`,
    [leagueId],
  );
  const meta = await db.query<{ name: string }>("select name from leagues where id = $1", [leagueId]);
  return {
    ok: true as const,
    name: meta[0]?.name || "Liga",
    rows: rankLeague(people.map((person) => ({
      userId: person.user_id,
      username: person.username,
      equity: person.equity == null ? null : Number(person.equity),
      initial: person.initial == null ? null : Number(person.initial),
    }))),
  };
}
