"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { useApp } from "./shell";
import { AnimatedNumber, FlipList, ScreenSkeleton, Skeleton, useToast } from "./ui";
import { money, pct, when } from "@/lib/format";
import { ASSETS } from "@/lib/symbols";
import { PikasChat } from "./pikas-chat";

export function BattleScreen() {
  const { data } = useApp();
  const toast = useToast();
  const [battles, setBattles] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ symbol: "BTC", voteMinutes: 30, competeMinutes: 120, rewardPct: "1", riskPct: "0.8" });
  async function load() {
    try { const res = await api<{ battles: Array<Record<string, unknown>> }>("/api/battle"); setBattles(res.battles); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudieron cargar las rondas"); setBattles([]); }
  }
  useEffect(() => { load().catch(() => undefined); }, []);
  return (
    <div className="grid">
      <div><p className="kicker">Market Battle</p><h1>Predice la dirección</h1><p className="muted">SUBE o BAJA antes de que cierre la votación. El resultado sale de velas reales. Si una vela toca las dos barreras, no se inventa un ganador.</p></div>
      {data?.user.role === "admin" ? (
        <form className="panel row" onSubmit={async (event) => { event.preventDefault(); await api("/api/battle", { method: "POST", body: JSON.stringify(form) }); toast({ title: "Ronda creada", tone: "ok" }); await load(); }}>
          <select aria-label="Activo de la ronda" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })}>{ASSETS.filter((asset) => asset.kind === "crypto").map((asset) => <option key={asset.symbol}>{asset.symbol}</option>)}</select>
          <input type="number" value={form.voteMinutes} onChange={(e) => setForm({ ...form, voteMinutes: Number(e.target.value) })} />
          <input type="number" value={form.competeMinutes} onChange={(e) => setForm({ ...form, competeMinutes: Number(e.target.value) })} />
          <button className="btn btn-primary" type="submit">Crear ronda</button>
        </form>
      ) : null}
      {battles === null ? <ScreenSkeleton /> : null}
      {error ? <p className="status-bad" role="alert">{error}</p> : null}
      {(battles || []).map((battle) => (
        <article className="card" key={String(battle.id)}>
          <div className="row"><h2>{String(battle.symbol)}</h2><span className="chip">{String(battle.status)}</span></div>
          <p className="fine">Voto hasta {when(Number(battle.vote_ends_at))} · fin {when(Number(battle.ends_at))}</p>
          <p>Objetivo {String(battle.reward_pct)}% · riesgo {String(battle.risk_pct)}% · inicio {battle.start_price ? money(String(battle.start_price)) : "aún no fijado"} · fuente {String(battle.source || "pendiente")}</p>
          <p className="fine">{String(battle.rules || "")}</p>
          <p>{Number(battle.participants)} participantes {battle.upPct != null ? `· SUBE ${pct(Number(battle.upPct) * 100, 0)} · BAJA ${pct(Number(battle.downPct) * 100, 0)}` : "· la distribución se muestra al cerrar el voto"}</p>
          {battle.status === "voting" ? (
            <div className="row">
              <button className="btn btn-primary" type="button" onClick={async () => { await api("/api/battle/vote", { method: "POST", body: JSON.stringify({ battleId: battle.id, direction: "up" }) }); await load(); }}>SUBE</button>
              <button className="btn" type="button" onClick={async () => { await api("/api/battle/vote", { method: "POST", body: JSON.stringify({ battleId: battle.id, direction: "down" }) }); await load(); }}>BAJA</button>
              {battle.myVote ? <span>Tu voto: {String(battle.myVote)}</span> : null}
            </div>
          ) : null}
          {battle.resolution_note ? <p>{String(battle.resolution_note)}</p> : null}
        </article>
      ))}
      {battles && battles.length === 0 ? <p className="empty">No hay rondas. Un administrador puede crear la primera.</p> : null}
    </div>
  );
}

export function ArenaScreen() {
  const toast = useToast();
  const [board, setBoard] = useState<{ agents: Array<Record<string, unknown>>; decisions: Array<Record<string, unknown>> } | null>(null);
  const [error, setError] = useState("");
  const [symbol, setSymbol] = useState("BTC");
  async function load() {
    try { setBoard(await api("/api/arena")); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo cargar la arena"); }
  }
  useEffect(() => { load().catch(() => undefined); }, []);
  return (
    <div className="grid">
      <div><p className="kicker">AI Arena</p><h1>Mismas reglas, cuentas separadas</h1><p className="muted">Cada motor con su variable de entorno es un competidor con cuenta simulada propia. El mismo contexto para todos. Sin clave: no configurado y sin operaciones. El baseline es una regla, no un modelo.</p></div>
      <div className="row">
        {ASSETS.filter((asset) => asset.kind === "crypto").map((asset) => <button key={asset.symbol} className={symbol === asset.symbol ? "chip on" : "chip"} type="button" onClick={() => setSymbol(asset.symbol)}>{asset.symbol}</button>)}
        <button className="btn btn-primary" type="button" onClick={async () => {
          try { await api("/api/arena/run", { method: "POST", body: JSON.stringify({ symbol, mode: "competition" }) }); toast({ title: "Ciclo registrado", tone: "ok" }); await load(); }
          catch (err) { toast({ title: "No se ejecutó", body: err instanceof Error ? err.message : "", tone: "danger" }); }
        }}>Ejecutar ciclo</button>
      </div>
      <div className="cards">
        {(board?.agents || []).map((agent) => (
          <article className="card" key={String(agent.id)}>
            <h3>{String(agent.name)}</h3>
            <p className="fine">{String(agent.description)}</p>
            <p>{agent.kind === "rules" ? "Reglas locales" : agent.configured ? "Configurado" : "No configurado"}</p>
          </article>
        ))}
      </div>
      <h2>Decisiones</h2>
      {(board?.decisions || []).map((decision) => (
        <article className="card" key={String(decision.id)}>
          <strong>{String(decision.action)}</strong> · {decision.provider === "rules" ? "Regla técnica" : `${String(decision.provider)} · ${String(decision.model || "")}`}
          <p>{String(decision.rationale || "")}</p>
          <p className="fine">{String(decision.execution_note || "")} {Number(decision.self_reported) ? "· confianza autodeclarada, no calibrada" : ""}</p>
        </article>
      ))}
    </div>
  );
}

export function AdvisorScreen() {
  const [symbol, setSymbol] = useState("BTC");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [question, setQuestion] = useState("¿Qué dicen los indicadores de este activo?");
  const [answer, setAnswer] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<Record<string, unknown>>(`/api/advisor/indicators?symbol=${symbol}`).then(setData).catch((err) => setError(err.message)); }, [symbol]);
  const latest = (data?.latest || null) as Record<string, number | null> | null;
  return (
    <div className="grid">
      <div><p className="kicker">AI Advisor</p><h1>Lectura del mercado</h1></div>
      <div className="tabs" role="tablist" aria-label="Activo del análisis">{ASSETS.map((asset) => <button key={asset.symbol} role="tab" aria-selected={symbol === asset.symbol} className={symbol === asset.symbol ? "chip on" : "chip"} type="button" onClick={() => setSymbol(asset.symbol)}>{asset.symbol}</button>)}</div>
      <article className="panel">
        <p className="fine">{String(data?.label || "")} Fuente: {String(data?.source || "n/d")}</p>
        {!data && !error ? <ScreenSkeleton /> : null}
        {error || data?.error ? <p className="status-bad" role="alert">{error || String(data?.error)}</p> : null}
        {latest ? (
          <div className="cards">
            {Object.entries(latest).filter(([key]) => key !== "ts").map(([key, value]) => (
              <div className="card" key={key}><span className="kicker">{key}</span><b>{value == null ? "n/d" : Number(value).toFixed(2)}</b></div>
            ))}
          </div>
        ) : data ? <p className="empty">Sin velas suficientes para los indicadores.</p> : null}
      </article>
      {data?.ai ? (
        <form className="panel grid" onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try { setAnswer(await api("/api/advisor/ask", { method: "POST", body: JSON.stringify({ symbol, question }) })); }
          catch (err) { setError(err instanceof Error ? err.message : "Error"); }
        }}>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} />
          <button className="btn btn-primary" type="submit">Preguntar al modelo</button>
          {answer ? <div><p>{String(answer.content)}</p><p className="fine">PIKAS AI · {String(answer.disclaimer || "")}</p></div> : null}
        </form>
      ) : <p className="panel">El chat del advisor no está configurado. Arriba solo ves cálculos locales.</p>}
    </div>
  );
}

export function PikasScreen() {
  return (
    <div className="grid">
      <PikasChat />
    </div>
  );
}

export function RankingsScreen() {
  const [windowName, setWindowName] = useState("all");
  const [data, setData] = useState<{ paper: Array<Record<string, unknown>>; battle: Array<Record<string, unknown>>; arena: Array<Record<string, unknown>>; note: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    api<NonNullable<typeof data>>(`/api/rankings?window=${windowName}`).then((next) => { setData(next); setError(""); }).catch((err) => setError(err instanceof Error ? err.message : "No se pudo calcular el ranking"));
  }, [windowName]);
  const paper = (data?.paper || []).map((row) => ({ ...row, id: String(row.accountId) }));
  const battle = (data?.battle || []).map((row) => ({ ...row, id: String(row.userId) }));
  return (
    <div className="grid">
      <div><p className="kicker">Rankings</p><h1>Clasificación</h1><p className="muted">{data?.note}</p></div>
      <div className="tabs" role="tablist" aria-label="Periodo">{[["all", "Histórico"], ["day", "Día"], ["week", "Semana"], ["month", "Mes"]].map(([id, label]) => <button key={id} role="tab" aria-selected={windowName === id} className={windowName === id ? "chip on" : "chip"} type="button" onClick={() => setWindowName(id)}>{label}</button>)}</div>
      {error ? <p className="status-bad" role="alert">{error}</p> : null}
      {!data && !error ? <ScreenSkeleton /> : null}
      <section>
        <h2>Paper trading</h2>
        {paper.length === 0 && data ? <p className="empty">Todavía no hay cuentas para ordenar.</p> : null}
        <FlipList items={paper} render={(row) => (
          <div className="rank card">
            <b>#{String(row.rank)}</b>
            <div><strong>{String((row.user as { username?: string } | null)?.username || "usuario")}</strong><div className="fine">inicial {money(String(row.initialBalance))} · {String(row.valuation)} · {String(row.trades)} ops</div></div>
            <div>{row.returnPct == null ? "—" : <AnimatedNumber value={Number(row.returnPct) * 100} format={(n) => pct(n)} />}</div>
          </div>
        )} />
      </section>
      <section>
        <h2>Market Battle</h2>
        {battle.length === 0 && data ? <p className="empty">Sin puntos en este periodo.</p> : null}
        <FlipList items={battle} render={(row) => (
          <div className="rank card">
            <b>#{String(row.rank)}</b>
            <span>{String((row.user as { username?: string } | null)?.username || "usuario")}</span>
            <span><AnimatedNumber value={Number(row.points)} format={(n) => `${Math.round(n)} pts`} /></span>
          </div>
        )} />
      </section>
      <section>
        <h2>Arena</h2>
        {(data?.arena || []).map((row) => {
          const agent = row.agent as { name?: string };
          return <article className="card" key={String(agent?.name)}><strong>{agent?.name}</strong><p>{row.score == null ? String(row.reason) : `Puntuación ${row.score}`}</p><p className="fine">{String(row.reason || "")}</p></article>;
        })}
      </section>
    </div>
  );
}
