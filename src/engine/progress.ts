export interface ProgressFacts {
  trades: number;
  wins: number;
  votes: number;
  resolvedRounds: number;
  freeCalls: number;
  streakDays: number;
}

export interface Badge {
  id: string;
  name: string;
  hint: string;
  earned: boolean;
}

const BADGE_DEFS: Array<{ id: string; name: string; hint: string; test: (facts: ProgressFacts) => boolean }> = [
  { id: "primera", name: "Primera orden", hint: "Cierra una operación simulada.", test: (facts) => facts.trades >= 1 },
  { id: "acierto", name: "Acierto", hint: "Cierra una operación con beneficio.", test: (facts) => facts.wins >= 1 },
  { id: "diez", name: "Diez cierres", hint: "Acumula 10 cierres simulados.", test: (facts) => facts.trades >= 10 },
  { id: "votante", name: "Voz en la mesa", hint: "Vota en una ronda unida.", test: (facts) => facts.votes >= 1 },
  { id: "racha3", name: "Racha de tres", hint: "Haz algo en tres días distintos seguidos.", test: (facts) => facts.streakDays >= 3 },
  { id: "libre", name: "Llamada propia", hint: "Registra una llamada del modo libre.", test: (facts) => facts.freeCalls >= 1 },
];

const LEVELS = ["Observador", "Aprendiz", "Operador", "Estratega", "Mesa"];

export function xpFrom(facts: ProgressFacts): number {
  return facts.trades * 15 + facts.wins * 10 + facts.votes * 8 + facts.resolvedRounds * 20 + facts.freeCalls * 10 + facts.streakDays * 5;
}

export function levelFromXp(xp: number): { level: number; title: string; into: number; span: number } {
  const safe = Math.max(0, Math.floor(xp));
  const level = Math.floor(safe / 100) + 1;
  return { level, title: LEVELS[Math.min(LEVELS.length - 1, level - 1)], into: safe % 100, span: 100 };
}

export function badgesFor(facts: ProgressFacts): Badge[] {
  return BADGE_DEFS.map((badge) => ({ id: badge.id, name: badge.name, hint: badge.hint, earned: badge.test(facts) }));
}

export function streakFromDays(dayKeys: string[], todayKey: string): number {
  const set = new Set(dayKeys);
  const cursor = new Date(`${todayKey}T12:00:00Z`);
  if (!set.has(todayKey)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let count = 0;
  while (set.has(cursor.toISOString().slice(0, 10))) {
    count += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return count;
}

const CHALLENGES = [
  { id: "votar", text: "Vota en la ronda unida que esté abierta." },
  { id: "grafico", text: "Abre Trading y mira un gráfico con velas reales." },
  { id: "comparar", text: "Abre Progreso y compara tu marca con una IA." },
] as const;

export function dailyChallenge(dayKey: string): { id: string; text: string } {
  const index = [...dayKey].reduce((sum, char) => sum + char.charCodeAt(0), 0) % CHALLENGES.length;
  return CHALLENGES[index];
}

export function challengeDone(id: string, facts: { votedToday: boolean; openedChart: boolean; compared: boolean }): boolean {
  if (id === "votar") return facts.votedToday;
  if (id === "grafico") return facts.openedChart;
  if (id === "comparar") return facts.compared;
  return false;
}

export function compareSides(rows: Array<{ actor: string; points: number }>, userId: string): Array<{ actor: string; user: number; other: number; rounds: number }> {
  const byRound = new Map<string, { user?: number; others: Array<{ actor: string; points: number }> }>();
  for (const row of rows) {
    const [round, actor] = row.actor.split("|");
    const bucket = byRound.get(round) || { others: [] };
    if (actor === `user:${userId}`) bucket.user = row.points;
    else bucket.others.push({ actor, points: row.points });
    byRound.set(round, bucket);
  }
  const totals = new Map<string, { user: number; other: number; rounds: number }>();
  for (const bucket of byRound.values()) {
    if (bucket.user == null) continue;
    for (const other of bucket.others) {
      const current = totals.get(other.actor) || { user: 0, other: 0, rounds: 0 };
      current.user += bucket.user;
      current.other += other.points;
      current.rounds += 1;
      totals.set(other.actor, current);
    }
  }
  return [...totals.entries()].map(([actor, row]) => ({ actor, ...row }));
}
