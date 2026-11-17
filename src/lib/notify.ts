import type { Db } from "./db";

export async function notifyOnce(db: Db, userId: string, category: string, title: string, body: string, now = Date.now()) {
  const existing = await db.query(
    "select id from notifications where user_id = $1 and category = $2 and title = $3 limit 1",
    [userId, category, title],
  );
  if (existing.length) return false;
  await db.query(
    "insert into notifications (id, user_id, category, title, body, created_at) values ($1,$2,$3,$4,$5,$6)",
    [crypto.randomUUID(), userId, category, title, body, now],
  );
  return true;
}

export async function notifyResolvedRondas(db: Db, now = Date.now()) {
  const rondas = await db.query<{ id: string; label: string }>(
    "select id, label from rondas where status = 'resolved' and resolved_at > $1",
    [now - 3 * 24 * 60 * 60 * 1000],
  );
  for (const ronda of rondas) {
    const picks = await db.query<{ actor_id: string; points: string; outcome: string }>(
      "select actor_id, points, outcome from ronda_picks where ronda_id = $1 and actor_type = 'user' and points is not null",
      [ronda.id],
    );
    for (const pick of picks) {
      await notifyOnce(db, pick.actor_id, "ronda", `Ronda resuelta: ${ronda.label}`, `Tu resultado guardado es ${pick.points} (${pick.outcome}).`);
    }
  }
}
