"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { EmptyState, ScreenSkeleton, useToast } from "./ui";

export function LeaguesScreen() {
  const toast = useToast();
  const [leagues, setLeagues] = useState<Array<{ id: string; name: string; owner_id: string }> | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [freshCode, setFreshCode] = useState("");
  const [board, setBoard] = useState<{ name: string; rows: Array<{ username: string; returnPct: number | null }> } | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const res = await api<{ leagues: Array<{ id: string; name: string; owner_id: string }> }>("/api/ligas");
    setLeagues(res.leagues);
  }
  useEffect(() => { load().catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar las ligas")); }, []);

  return (
    <div className="grid">
      <div>
        <p className="kicker">Ligas</p>
        <h1>Entre amigos</h1>
        <p className="muted">El código se enseña una sola vez. El ranking usa el patrimonio simulado de cada cuenta. Quien no tiene cuenta aparece sin rentabilidad.</p>
      </div>
      {error ? <p className="status-bad" role="alert">{error}</p> : null}
      <form className="panel grid" onSubmit={async (event) => {
        event.preventDefault();
        try {
          const res = await api<{ code: string; name: string }>("/api/ligas", { method: "POST", body: JSON.stringify({ name }) });
          setFreshCode(res.code);
          toast({ title: "Liga creada", body: "Guarda el código: no se vuelve a mostrar.", tone: "ok" });
          setName("");
          await load();
        } catch (err) { toast({ title: "No se creó", body: err instanceof ApiError ? err.message : "", tone: "danger" }); }
      }}>
        <label className="field">Nombre<input value={name} onChange={(event) => setName(event.target.value)} required minLength={3} /></label>
        <button className="btn btn-primary" type="submit">Crear liga</button>
        {freshCode ? <p role="status">Código: <strong>{freshCode}</strong></p> : null}
      </form>
      <form className="panel row" onSubmit={async (event) => {
        event.preventDefault();
        try {
          await api("/api/ligas/unirse", { method: "POST", body: JSON.stringify({ code }) });
          toast({ title: "Ya estás en la liga", tone: "ok" });
          setCode("");
          await load();
        } catch (err) { toast({ title: "No se pudo entrar", body: err instanceof ApiError ? err.message : "", tone: "danger" }); }
      }}>
        <label className="field">Código<input value={code} onChange={(event) => setCode(event.target.value)} required /></label>
        <button className="btn btn-secondary" type="submit">Unirme</button>
      </form>
      {leagues === null ? <ScreenSkeleton /> : null}
      {leagues && leagues.length === 0 ? <EmptyState title="Sin ligas" body="Crea una y pasa el código a quien quieras comparar." /> : null}
      {(leagues || []).map((league) => (
        <article className="card" key={league.id}>
          <h2>{league.name}</h2>
          <button className="btn" type="button" onClick={async () => setBoard(await api(`/api/ligas/tabla?id=${league.id}`))}>Ver ranking</button>
        </article>
      ))}
      {board ? (
        <section className="panel">
          <h2>{board.name}</h2>
          <ol className="stack">
            {board.rows.map((row, index) => <li key={row.username}>{index + 1}. {row.username} · {row.returnPct == null ? "sin cuenta simulada" : `${(row.returnPct * 100).toFixed(1)}%`}</li>)}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

export function AcademyScreen() {
  const toast = useToast();
  const [lessons, setLessons] = useState<Array<{ id: string; title: string; body: string; question: string; choices: string[]; passed: boolean }> | null>(null);
  const [badge, setBadge] = useState<{ name: string } | null>(null);
  const [choice, setChoice] = useState<Record<string, number>>({});
  useEffect(() => {
    api<{ lessons: NonNullable<typeof lessons>; badge: { name: string } | null }>("/api/academia").then((res) => { setLessons(res.lessons); setBadge(res.badge); }).catch(() => setLessons([]));
  }, []);
  if (!lessons) return <ScreenSkeleton />;
  return (
    <div className="grid">
      <div>
        <p className="kicker">Academia</p>
        <h1>Cinco ideas, sin dinero real</h1>
        <p className="muted">Cada lección termina en una pregunta. La medalla llega al aprobar las cinco.</p>
      </div>
      {badge ? <p className="up">Medalla: {badge.name}</p> : null}
      {lessons.length === 0 ? <EmptyState title="No se cargaron las lecciones" body="Recarga la página. El contenido vive en la app, no en un servicio de pago." /> : null}
      {lessons.map((lesson) => (
        <article className="card grid" key={lesson.id}>
          <h2>{lesson.title} {lesson.passed ? "· aprobada" : ""}</h2>
          <p>{lesson.body}</p>
          <p><strong>{lesson.question}</strong></p>
          {lesson.choices.map((text, index) => (
            <button key={text} className={choice[lesson.id] === index ? "btn btn-secondary" : "btn"} type="button" onClick={() => setChoice({ ...choice, [lesson.id]: index })}>{text}</button>
          ))}
          <button className="btn btn-primary" type="button" disabled={choice[lesson.id] == null} onClick={async () => {
            try {
              const res = await api<{ ok: boolean; error?: string }>("/api/academia", { method: "POST", body: JSON.stringify({ id: lesson.id, choice: choice[lesson.id] }) });
              if (!res.ok) { toast({ title: res.error || "Respuesta incorrecta", tone: "danger" }); return; }
              toast({ title: "Lección aprobada", tone: "ok" });
              const next = await api<{ lessons: typeof lessons; badge: { name: string } | null }>("/api/academia");
              setLessons(next.lessons);
              setBadge(next.badge);
            } catch (err) { toast({ title: "No se guardó", body: err instanceof Error ? err.message : "", tone: "danger" }); }
          }}>Comprobar</button>
        </article>
      ))}
    </div>
  );
}

export function PublicProfile({ username }: { username: string }) {
  const [profile, setProfile] = useState<{ username: string; progress: { level: { title: string }; xp: number; streakDays: number; badges: Array<{ name: string }> }; series: Array<{ equity: string }>; equity: string | null; initial: string | null } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<NonNullable<typeof profile>>(`/api/public/perfil?username=${encodeURIComponent(username)}`).then(setProfile).catch((err) => setError(err instanceof ApiError ? err.message : "Perfil no disponible"));
  }, [username]);
  return (
    <main className="auth-bg">
      <article className="card auth-card">
        <p className="kicker">Perfil público</p>
        <h1>{profile?.username || username}</h1>
        {error ? <p className="down">{error}</p> : null}
        {!profile && !error ? <ScreenSkeleton /> : null}
        {profile ? (
          <>
            <p>{profile.progress.level.title} · {profile.progress.xp} xp · racha {profile.progress.streakDays}</p>
            <p className="fine">Patrimonio simulado {profile.equity ?? "sin cuenta"} · inicial {profile.initial ?? "—"}</p>
            {profile.series.length < 2 ? <p className="empty">Aún no hay suficientes puntos de equity guardados para un gráfico.</p> : <p className="fine">{profile.series.length} puntos de equity guardados.</p>}
            <ul className="stack">{profile.progress.badges.map((badge) => <li key={badge.name}>{badge.name}</li>)}</ul>
            {profile.progress.badges.length === 0 ? <p className="empty">Sin medallas todavía.</p> : null}
            <p><a href={`/api/public/perfil.svg?username=${encodeURIComponent(profile.username)}`}>Tarjeta para compartir</a></p>
          </>
        ) : null}
        <Link href="/login">Entrar</Link>
      </article>
    </main>
  );
}
