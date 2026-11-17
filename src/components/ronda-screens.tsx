"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { PikasMark } from "./logo";
import { useApp } from "./shell";
import { ScreenSkeleton, useToast } from "./ui";
import { money, when } from "@/lib/format";
import { ASSET_SYMBOLS } from "@/lib/symbols";

type Side = "up" | "down";

interface Pick {
  id: string;
  actor_type: string;
  display_name: string;
  side: string;
  rationale?: string | null;
  entry_price?: string | null;
  stop_price?: string | null;
  target_price?: string | null;
  points?: string | null;
  outcome?: string | null;
}

interface Ronda {
  id: string;
  label: string;
  symbol: string;
  status: string;
  starts_at: number;
  ends_at: number;
  entry_price?: string | null;
  stop_pct?: string | null;
  target_pct?: string | null;
  source?: string | null;
  resolution_note?: string | null;
  mine?: { side: string } | null;
  votes?: number | null;
  teams?: { comunidad: string | null; ia: string | null; bots: string | null; quorum: number } | null;
  picks?: Pick[];
}

export function RondaScreen() {
  const toast = useToast();
  const [rondas, setRondas] = useState<Ronda[] | null>(null);
  const [sentiment, setSentiment] = useState<Record<string, unknown> | null>(null);
  const [brief, setBrief] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await api<{ rondas: Ronda[]; sentiment: Record<string, unknown> | null; brief: Record<string, unknown> | null }>("/api/ronda");
      setRondas(res.rondas);
      setSentiment(res.sentiment);
      setBrief(res.brief);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la ronda");
      setRondas([]);
    }
  }

  useEffect(() => { load().catch(() => undefined); }, []);

  async function vote(rondaId: string, side: Side) {
    try {
      await api("/api/ronda/vote", { method: "POST", body: JSON.stringify({ rondaId, side }) });
      toast({ title: side === "up" ? "Voto: sube" : "Voto: baja", tone: "ok" });
      await load();
    } catch (err) {
      toast({ title: "No se guardó el voto", body: err instanceof ApiError ? err.message : "", tone: "danger" });
    }
  }

  const value = sentiment?.value == null ? null : Number(sentiment.value);

  return (
    <div className="grid">
      <div>
        <p className="kicker">Ronda unida</p>
        <h1>La misma entrada para todos</h1>
        <p className="muted">Personas, IAs configuradas y bots de reglas comparten precio, stop y objetivo. El stop sale del percentil de rango de velas reales y el objetivo es 1,5 veces ese stop. Si en un minuto se tocan los dos, cuenta el stop. Si una IA no responde, esa ronda no juega.</p>
      </div>
      <section className="panel grid">
        <h2>Termómetro</h2>
        {value == null ? <p className="empty">Sin lectura. La fuente es alternative.me y ahora no hay un valor guardado.</p> : (
          <>
            <p><strong>{value}</strong> <span className="fine">{String(sentiment?.label || "")} · {String(sentiment?.status)}</span></p>
            <div className="thermo" aria-hidden><i style={{ left: `${Math.min(100, Math.max(0, value))}%` }} /></div>
          </>
        )}
        <p className="fine">Fuente: alternative.me. {sentiment?.detail ? String(sentiment.detail) : "No es una señal de PIKAS."}</p>
      </section>
      {rondas === null ? <ScreenSkeleton /> : null}
      {error ? <p className="status-bad" role="alert">{error}</p> : null}
      {rondas?.length === 0 ? <p className="empty">No hay una sesión abierta. Se abren con Asia (02:00), Londres (09:00) y Nueva York (15:30), hora de Madrid.</p> : null}
      {(rondas || []).map((ronda) => (
        <article className="card grid" key={ronda.id}>
          <div className="row"><h2>{ronda.label}</h2><span className="chip">{ronda.status}</span></div>
          <p className="fine">{ronda.symbol} · empieza {when(Number(ronda.starts_at))} · cierra {when(Number(ronda.ends_at))}</p>
          <p>Entrada {ronda.entry_price ? money(ronda.entry_price) : "se fija al empezar"} · stop {ronda.stop_pct || "—"}% · objetivo {ronda.target_pct || "—"}% · fuente {ronda.source || "pendiente"}</p>
          {ronda.status === "voting" ? (
            <div className="row">
              <button className="btn btn-primary" type="button" onClick={() => vote(ronda.id, "up")}>Sube</button>
              <button className="btn" type="button" onClick={() => vote(ronda.id, "down")}>Baja</button>
              <span className="fine">{ronda.mine ? `Tu voto actual: ${ronda.mine.side === "up" ? "sube" : "baja"}. Puedes cambiarlo.` : "Aún no has votado."}</span>
            </div>
          ) : null}
          {ronda.teams ? (
            <p>Comunidad {ronda.teams.comunidad ?? `sin quórum (${ronda.teams.quorum})`} · IA {ronda.teams.ia ?? "sin respuestas"} · Bots {ronda.teams.bots ?? "sin juego"}</p>
          ) : <p className="fine">Los recuentos se muestran cuando cierra el voto, para no condicionar.</p>}
          {ronda.resolution_note ? <p className="fine">{ronda.resolution_note}</p> : null}
          <ul className="stack">
            {(ronda.picks || []).map((pick) => (
              <li key={pick.id}>
                <strong>{pick.display_name}</strong> · {pick.actor_type} · {pick.side === "up" ? "sube" : "baja"}
                {pick.points != null ? ` · ${pick.points} pts (${pick.outcome})` : ""}
                {pick.rationale ? <span className="fine"> — {pick.rationale}</span> : null}
              </li>
            ))}
          </ul>
        </article>
      ))}
      <section className="panel">
        <h2>Resumen del día</h2>
        {brief ? <p>{String(brief.body)}</p> : <p className="empty">Todavía no hay un resumen guardado de hoy. Se crea en el siguiente pulso del navegador.</p>}
        <p className="fine">OpenTimestamps no está conectado: haría falta un calendario gratuito y una prueba real. El siguiente paso queda anotado en la documentación. La cadena SHA-256 sí se puede comprobar.</p>
        <p><Link href="/verificar">Verificar un hash</Link> · <Link href="/libre">Modo libre</Link> · <Link href="/temporada">Temporada</Link></p>
      </section>
    </div>
  );
}

export function LibreScreen() {
  const { data } = useApp();
  const toast = useToast();
  const [symbol, setSymbol] = useState("BTC");
  const [side, setSide] = useState<Side>("up");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [horizon, setHorizon] = useState("4h");
  const [calls, setCalls] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState("");
  const quote = data?.quotes.find((item) => item.symbol === symbol);

  async function load() {
    try {
      const res = await api<{ calls: Array<Record<string, unknown>> }>("/api/libre");
      setCalls(res.calls);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las llamadas");
      setCalls([]);
    }
  }
  useEffect(() => { load().catch(() => undefined); }, []);

  return (
    <div className="grid">
      <div>
        <p className="kicker">Modo libre</p>
        <h1>Tú fijas los niveles</h1>
        <p className="muted">La entrada es el precio real de la fuente. El stop no puede pasar del 10% y el objetivo tiene que pagar al menos 0,25 veces el riesgo. El ranking de esta modalidad es aparte.</p>
      </div>
      <form className="panel grid" onSubmit={async (event) => {
        event.preventDefault();
        if (!quote?.price) return;
        try {
          await api("/api/libre", { method: "POST", body: JSON.stringify({ symbol, side, entry: quote.price, stop, target, horizon }) });
          toast({ title: "Llamada libre registrada", tone: "ok" });
          await load();
        } catch (err) {
          toast({ title: "No se abrió", body: err instanceof ApiError ? err.message : "", tone: "danger" });
        }
      }}>
        <label className="field">Activo
          <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>{ASSET_SYMBOLS.map((item) => <option key={item}>{item}</option>)}</select>
        </label>
        <p>Entrada {quote?.price ? money(quote.price) : "sin precio"} · {quote?.source || "sin fuente"} · {quote?.executable ? "ejecutable" : "no ejecutable"}</p>
        <div className="chips">
          <button type="button" className={side === "up" ? "chip on" : "chip"} onClick={() => setSide("up")}>Sube</button>
          <button type="button" className={side === "down" ? "chip on" : "chip"} onClick={() => setSide("down")}>Baja</button>
        </div>
        <label className="field">Stop<input value={stop} onChange={(event) => setStop(event.target.value)} inputMode="decimal" required /></label>
        <label className="field">Objetivo<input value={target} onChange={(event) => setTarget(event.target.value)} inputMode="decimal" required /></label>
        <label className="field">Plazo
          <select value={horizon} onChange={(event) => setHorizon(event.target.value)}>
            <option value="4h">4 horas</option>
            <option value="8h">8 horas</option>
            <option value="24h">24 horas</option>
            <option value="1w">1 semana</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit" disabled={!quote?.executable}>Registrar llamada simulada</button>
      </form>
      {calls === null ? <ScreenSkeleton /> : null}
      {error ? <p className="status-bad" role="alert">{error}</p> : null}
      {calls?.length === 0 ? <p className="empty">Todavía no tienes llamadas libres.</p> : null}
      <div className="cards">
        {(calls || []).map((call) => (
          <article className="card" key={String(call.id)}>
            <strong>{String(call.symbol)} · {String(call.side)} · {String(call.horizon)}</strong>
            <p className="fine">Entrada {money(String(call.entry_price))} · stop {money(String(call.stop_price))} · objetivo {money(String(call.target_price))}</p>
            <p>{String(call.status)} {call.points != null ? `· ${String(call.points)} pts` : ""}</p>
            <p className="fine">{String(call.note || call.source || "")}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

export function TemporadaScreen() {
  const toast = useToast();
  const [season, setSeason] = useState<{ month: string; minimum: number; reference: string; referencePoints: string | null; rows: Array<Record<string, unknown>> } | null>(null);
  const [poll, setPoll] = useState<{ month: string; votes: Array<{ choice: string; count: number }> } | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await api<{ season: NonNullable<typeof season>; poll: NonNullable<typeof poll> }>("/api/temporada");
      setSeason(res.season);
      setPoll(res.poll);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la temporada");
    }
  }
  useEffect(() => { load().catch(() => undefined); }, []);

  async function choose(choice: string) {
    try {
      await api("/api/temporada/encuesta", { method: "POST", body: JSON.stringify({ choice }) });
      toast({ title: "Voto del mes guardado", tone: "ok" });
      await load();
    } catch (err) {
      toast({ title: "No se guardó", body: err instanceof ApiError ? err.message : "", tone: "danger" });
    }
  }

  return (
    <div className="grid">
      <div>
        <p className="kicker">Temporada</p>
        <h1>Mes en curso</h1>
        <p className="muted">Hacen falta al menos 10 rondas resueltas para clasificar. La comparación es contra Dado ciego, el bot de referencia.</p>
      </div>
      {error ? <p className="status-bad" role="alert">{error}</p> : null}
      {!season ? <ScreenSkeleton /> : (
        <section className="panel">
          <h2>{season.month}</h2>
          <p className="fine">{season.reference}: {season.referencePoints ?? "todavía sin rondas"} puntos. Mínimo {season.minimum} rondas.</p>
          {season.rows.length === 0 ? <p className="empty">Nadie tiene rondas resueltas este mes.</p> : (
            <ul className="stack">
              {season.rows.map((row) => (
                <li key={String(row.id)}>{String(row.name)} · {String(row.rounds)} rondas · {String(row.points)} pts · {row.qualifies ? String(row.versus) : "no clasifica"}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className="panel grid">
        <h2>¿Quién ganará {poll?.month || "el mes que viene"}?</h2>
        <div className="row">
          <button className="btn" type="button" onClick={() => choose("comunidad")}>Comunidad</button>
          <button className="btn" type="button" onClick={() => choose("ia")}>IA</button>
          <button className="btn" type="button" onClick={() => choose("bots")}>Bots</button>
        </div>
        <ul className="stack">
          {(poll?.votes || []).map((vote) => <li key={vote.choice}>{vote.choice}: {vote.count}</li>)}
        </ul>
        {poll && poll.votes.length === 0 ? <p className="empty">Aún no hay votos para ese mes.</p> : null}
      </section>
    </div>
  );
}

export function VerificarScreen() {
  const [hash, setHash] = useState("");
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState("");

  return (
    <main className="auth-bg">
      <form className="card auth-card" onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        try {
          const res = await api<{ found: boolean; intact: boolean; row: { canonical: string; ok: boolean } | null }>(`/api/public/verificar?hash=${encodeURIComponent(hash.trim())}`);
          setResult(res.found ? `Encontrado. Eslabón ${res.row?.ok ? "válido" : "roto"}. Cadena ${res.intact ? "íntegra" : "con un corte"}. ${res.row?.canonical || ""}` : "Ese hash no está en la cadena pública.");
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "No se pudo verificar");
        }
      }}>
        <PikasMark className="lg" />
        <p className="kicker">Registro</p>
        <h1>Verificar una predicción</h1>
        <p className="muted">Cada voto y cada llamada libre se encadenan con SHA-256 en el momento de crearse. Esta página no requiere sesión.</p>
        <label className="field">Hash SHA-256<input value={hash} onChange={(event) => setHash(event.target.value)} required spellCheck={false} autoComplete="off" /></label>
        <button className="btn btn-primary" type="submit">Comprobar</button>
        {error ? <p className="down" role="alert">{error}</p> : null}
        {result ? <p>{result}</p> : null}
        <p className="fine"><a href="/api/public/cadena?format=csv">Descargar CSV</a> · <a href="/api/public/cadena">Descargar JSON</a></p>
        <p className="fine"><Link href="/login">Entrar</Link></p>
      </form>
    </main>
  );
}
