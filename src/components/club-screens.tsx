"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { AnimatedNumber, ScreenSkeleton } from "./ui";
import { AiMark } from "./marks";

interface Progress {
  xp: number;
  level: { level: number; title: string; into: number; span: number };
  badges: Array<{ id: string; name: string; hint: string; earned: boolean }>;
  streakDays: number;
  challenge: { id: string; text: string; done: boolean };
  compare: Array<{ actor: string; name: string; user: number; other: number; rounds: number }>;
}

export function ProgresoScreen() {
  const [data, setData] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Progress>("/api/progreso").then(setData).catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar el progreso"));
  }, []);
  if (!data && !error) return <ScreenSkeleton />;
  return (
    <div className="grid stagger">
      <div>
        <p className="kicker">Progreso</p>
        <h1>{data?.level.title || "Observador"}</h1>
        <p className="muted">La experiencia sale de cierres, votos y rondas resueltas. Si no hay hechos, el nivel se queda en cero.</p>
      </div>
      {error ? <p className="status-bad" role="alert">{error}</p> : null}
      {data ? (
        <>
          <section className="panel">
            <p>Nivel <AnimatedNumber value={data.level.level} format={(n) => String(Math.round(n))} /> · <AnimatedNumber value={data.xp} format={(n) => `${Math.round(n)} xp`} /></p>
            <div className="thermo" aria-hidden><i style={{ left: `${data.level.into}%` }} /></div>
            <p className="fine">Racha de {data.streakDays} día{data.streakDays === 1 ? "" : "s"} con actividad real.</p>
          </section>
          <section className="panel">
            <h2>Reto de hoy</h2>
            <p>{data.challenge.text}</p>
            <p className={data.challenge.done ? "up" : "fine"}>{data.challenge.done ? "Hecho con datos guardados." : "Aún no consta en la base."}</p>
          </section>
          <section className="cards">
            {data.badges.map((badge) => (
              <article className="card" key={badge.id}>
                <span className="kicker">{badge.earned ? "Conseguida" : "Pendiente"}</span>
                <strong>{badge.name}</strong>
                <p className="fine">{badge.hint}</p>
              </article>
            ))}
          </section>
          <section className="panel">
            <h2>Tú frente a cada IA</h2>
            {data.compare.length === 0 ? <p className="empty">Hace falta una ronda resuelta en la que hayas votado y una IA también. Si ninguna respondió, no se inventa el duelo.</p> : (
              <ul className="stack">
                {data.compare.map((row) => (
                  <li key={row.actor}><AiMark id={row.name} /> {row.name}: tú {row.user.toFixed(2)} · IA {row.other.toFixed(2)} · {row.rounds} ronda{row.rounds === 1 ? "" : "s"}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

export function IasScreen() {
  const [rows, setRows] = useState<Array<{ id: string; label: string; configured: boolean; free: boolean; picks: number; scored: number; points: string | null }> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ providers: NonNullable<typeof rows> }>("/api/ias").then((res) => setRows(res.providers)).catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar las IAs"));
  }, []);
  if (!rows && !error) return <ScreenSkeleton />;
  return (
    <div className="grid stagger">
      <div>
        <p className="kicker">Las IAs</p>
        <h1>Ficha de cada motor</h1>
        <p className="muted">Sin clave no hay historial inventado. Con clave, la ficha suma solo las rondas unidas en las que ese motor respondió.</p>
      </div>
      {error ? <p className="status-bad" role="alert">{error}</p> : null}
      <div className="cards">
        {(rows || []).map((row) => (
          <article className="card" key={row.id}>
            <span className="kicker">{row.free ? "Capa gratuita o de prototipo" : "De pago, si se permite"}</span>
            <h2><AiMark id={row.id} /> {row.label}</h2>
            <p className={row.configured ? "up" : "fine"}>{row.configured ? "Configurado" : "No configurado"}</p>
            <p className="fine">{row.scored ? `${row.scored} rondas con puntos · ${row.points}` : "Sin rondas resueltas de este motor."}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
