"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";
import { useApp } from "./shell";
import { AnimatedNumber, ScreenSkeleton, useToast } from "./ui";
import { money, pct, signed, when } from "@/lib/format";
import { ASSET_SYMBOLS } from "@/lib/symbols";

export function HistoryScreen() {
  const [trades, setTrades] = useState<Array<Record<string, unknown>> | null>(null);
  const [symbol, setSymbol] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setTrades(null);
    api<{ trades: Array<Record<string, unknown>> }>(`/api/trading/history${symbol ? `?symbol=${symbol}` : ""}`)
      .then((res) => { setTrades(res.trades); setError(""); })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo leer el historial"));
  }, [symbol]);
  return (
    <div className="grid">
      <h1>Historial</h1>
      <div className="tabs" role="tablist" aria-label="Filtrar historial"><button className={!symbol ? "chip on" : "chip"} type="button" onClick={() => setSymbol("")}>Todos</button>{ASSET_SYMBOLS.map((item) => <button key={item} className={symbol === item ? "chip on" : "chip"} type="button" onClick={() => setSymbol(item)}>{item}</button>)}</div>
      {error ? <p className="status-bad" role="alert">{error}</p> : null}
      {trades === null && !error ? <ScreenSkeleton /> : null}
      <div className="table-wrap panel">
        <table>
          <caption className="sr">Historial de operaciones simuladas</caption>
          <thead><tr><th>Fecha</th><th>Activo</th><th>Lado</th><th>Entrada</th><th>Salida</th><th>Lev</th><th>Resultado</th><th>Comisión</th><th>Motivo</th></tr></thead>
          <tbody>
            {(trades || []).map((trade) => (
              <tr key={String(trade.id)}>
                <td>{when(Number(trade.closed_at))}</td>
                <td>{String(trade.symbol)}</td>
                <td>{String(trade.side)}</td>
                <td>{money(String(trade.entry_price))}</td>
                <td>{money(String(trade.exit_price))}</td>
                <td>{String(trade.leverage)}x</td>
                <td className={Number(trade.realized_pnl) < 0 ? "down" : "up"}>{signed(String(trade.realized_pnl))}</td>
                <td>{money(String(trade.fee), 4)}</td>
                <td>{String(trade.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {trades && trades.length === 0 ? <p className="empty">Todavía no hay cierres simulados.</p> : null}
      </div>
    </div>
  );
}

export function AlertsScreen() {
  const { data, refresh } = useApp();
  const toast = useToast();
  const [items, setItems] = useState<Array<Record<string, unknown>> | null>(null);
  const [notes, setNotes] = useState<Array<Record<string, unknown>> | null>(null);
  const [form, setForm] = useState({ symbol: "BTC", kind: "price_above", threshold: "" });
  async function load() {
    setItems((await api<{ alerts: Array<Record<string, unknown>> }>("/api/alerts")).alerts);
    setNotes((await api<{ notifications: Array<Record<string, unknown>> }>("/api/notifications")).notifications);
  }
  useEffect(() => { load().catch(() => undefined); }, []);
  return (
    <div className="grid">
      <div className="row"><h1>Alertas</h1><button className="btn" type="button" onClick={async () => { await api("/api/notifications/read", { method: "POST" }); await refresh(); await load(); }}>Marcar leídas</button></div>
      <p className="muted">Avisos dentro de la app. No hay push garantizado con el hosting gratuito.</p>
      <form className="panel row" onSubmit={async (event) => { event.preventDefault(); try { await api("/api/alerts", { method: "POST", body: JSON.stringify(form) }); setForm({ ...form, threshold: "" }); toast({ title: "Alerta creada", tone: "ok" }); await load(); } catch (err) { toast({ title: "No se creó", body: err instanceof Error ? err.message : "", tone: "danger" }); } }}>
        <select aria-label="Activo" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })}>{(data?.quotes || []).map((q) => <option key={q.symbol}>{q.symbol}</option>)}</select>
        <select aria-label="Tipo de alerta" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="price_above">Precio por encima</option><option value="price_below">Precio por debajo</option><option value="move_pct">Movimiento %</option></select>
        <input aria-label="Umbral" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} placeholder="Umbral" required />
        <button className="btn btn-primary" type="submit">Crear</button>
      </form>
      {items === null ? <ScreenSkeleton /> : null}
      {(items || []).map((alert) => <div className="card row" key={String(alert.id)}><span>{String(alert.symbol)} {String(alert.kind)} {String(alert.threshold)}</span><button className="btn" type="button" onClick={async () => { await api("/api/alerts/delete", { method: "POST", body: JSON.stringify({ id: alert.id }) }); toast({ title: "Alerta quitada" }); await load(); }}>Quitar</button></div>)}
      {items && items.length === 0 ? <p className="empty">No tienes alertas de precio.</p> : null}
      <h2>Bandeja</h2>
      {notes && notes.length === 0 ? <p className="empty">La bandeja está vacía.</p> : null}
      {(notes || []).map((note) => <article className="card" key={String(note.id)}><strong>{String(note.title)}</strong><p>{String(note.body)}</p><p className="fine">{when(Number(note.created_at))} · {String(note.category)} {note.read_at ? "" : "· nueva"}</p></article>)}
    </div>
  );
}

export function ProfileScreen() {
  const { data } = useApp();
  const router = useRouter();
  if (!data) return <ScreenSkeleton />;
  const account = data.account;
  return (
    <div className="grid">
      <div className="row"><span className="avatar" style={{ background: `hsl(${data.user.avatarHue} 70% 45%)`, width: 64, height: 64 }}>{data.user.username.slice(0, 1).toUpperCase()}</span><div><h1>{data.user.username}</h1><p className="muted">{data.user.email} · {data.user.role}</p></div></div>
      <div className="cards">
        <article className="card"><span className="kicker">Saldo inicial</span><b>{account ? <AnimatedNumber value={Number(account.initialBalance)} format={(n) => money(n)} /> : "—"}</b></article>
        <article className="card"><span className="kicker">Win rate</span><b>{account?.stats.winRate == null ? "—" : pct(account.stats.winRate * 100, 0)}</b></article>
        <article className="card"><span className="kicker">Mejor</span><b>{account?.stats.best == null ? "—" : signed(account.stats.best)}</b></article>
        <article className="card"><span className="kicker">Peor</span><b>{account?.stats.worst == null ? "—" : signed(account.stats.worst)}</b></article>
      </div>
      <button className="btn" type="button" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); router.push("/login"); }}>Cerrar sesión</button>
    </div>
  );
}

export function SettingsScreen() {
  const { data, refresh } = useApp();
  const toast = useToast();
  const [motion, setMotion] = useState(false);
  const [move, setMove] = useState("3");
  const [initial, setInitial] = useState("100");
  useEffect(() => {
    if (!data?.settings) return;
    setMotion(Boolean(data.settings.reduce_motion));
    setMove(String(data.settings.alert_move_pct || "3"));
  }, [data]);
  return (
    <div className="grid">
      <h1>Ajustes</h1>
      <form className="panel grid" onSubmit={async (event) => {
        event.preventDefault();
        await api("/api/settings", { method: "POST", body: JSON.stringify({ reduceMotion: motion, alertMovePct: move, autonomousEnabled: false }) });
        toast({ title: "Ajustes guardados", tone: "ok" });
        await refresh();
      }}>
        <label className="row"><input type="checkbox" checked={motion} onChange={(e) => setMotion(e.target.checked)} /> Reducir animaciones</label>
        <label className="field">Aviso si BTC, ETH o SOL se mueven más de este %<input value={move} onChange={(e) => setMove(e.target.value)} /></label>
        <p className="fine">La autonomía que opera sola queda apagada. PIKAS AI propone en el chat; no mueve la cuenta sin una orden tuya en Trading.</p>
        <button className="btn btn-primary" type="submit">Guardar</button>
      </form>
      <form className="panel grid" onSubmit={async (event) => {
        event.preventDefault();
        if (!confirm("Se cerrarán las posiciones al precio actual, si es ejecutable, y el saldo volverá al inicial.")) return;
        try {
          await api("/api/trading/reset", { method: "POST", body: JSON.stringify({ initial }) });
          toast({ title: "Cuenta reiniciada", tone: "ok" });
          await refresh();
        } catch (err) { toast({ title: "No se reinició", body: err instanceof Error ? err.message : "", tone: "danger" }); }
      }}>
        <h2>Reiniciar simulación</h2>
        <div className="chips">{["10", "50", "100", "500"].map((amount) => <button type="button" key={amount} className={initial === amount ? "chip on" : "chip"} onClick={() => setInitial(amount)}>{amount}</button>)}</div>
        <button className="btn btn-danger" type="submit">Reiniciar a {initial} USDT</button>
      </form>
    </div>
  );
}

export function RouterScreen() {
  const { data } = useApp();
  const [view, setView] = useState<Record<string, unknown> | null>(null);
  const [daily, setDaily] = useState("1");
  const [monthly, setMonthly] = useState("10");
  useEffect(() => { api<Record<string, unknown>>("/api/router").then(setView).catch(() => undefined); }, []);
  if (view && view.admin === false) {
    return (
      <div className="grid">
        <h1>PIKAS AI</h1>
        <p>{view.configured ? "PIKAS AI está activo. El detalle de los motores es solo de administración." : "PIKAS AI no configurado."}</p>
      </div>
    );
  }
  const providers = (view?.providers as Array<Record<string, unknown>>) || [];
  const spent = (view?.spent as { today: number; month: number; daily: number; monthly: number }) || null;
  return (
    <div className="grid">
      <div>
        <p className="kicker">Administración</p>
        <h1>Motores de PIKAS AI</h1>
        <p className="muted">{String(view?.pricesNote || "")} El chat nunca dice cuál respondió.</p>
      </div>
      <div className="cards">
        {providers.map((provider) => (
          <article className="card" key={String(provider.id)}>
            <h3>{String(provider.label)}</h3>
            <p>{provider.configured ? (provider.healthy ? "Configurado y disponible" : "En pausa") : "No configurado"}</p>
            <p className="fine">{provider.free ? "Prioridad gratuita" : "De pago, apagado salvo AI_ALLOW_PAID"} · prioridad {String(provider.priority)}</p>
            <p className="fine">{String(provider.cheap)}{provider.strong !== provider.cheap ? ` / ${String(provider.strong)}` : ""}</p>
            <p className="fine">Llamadas recientes {String(provider.recentCalls || 0)} · errores {String(provider.recentErrors || 0)} · estimado {Number(provider.estimatedCost || 0).toFixed(4)} USD</p>
            {provider.lastError ? <p className="status-bad">{String(provider.lastError)}</p> : null}
          </article>
        ))}
      </div>
      {spent ? <p>Estimado hoy {spent.today.toFixed(4)} USD de {spent.daily}. Mes {spent.month.toFixed(4)} de {spent.monthly}.</p> : null}
      {data?.user.role === "admin" ? (
        <form className="row" onSubmit={async (event) => { event.preventDefault(); await api("/api/router/budget", { method: "POST", body: JSON.stringify({ daily, monthly }) }); location.reload(); }}>
          <label className="field">Tope diario USD<input value={daily} onChange={(e) => setDaily(e.target.value)} /></label>
          <label className="field">Tope mensual USD<input value={monthly} onChange={(e) => setMonthly(e.target.value)} /></label>
          <button className="btn" type="submit">Guardar topes</button>
        </form>
      ) : null}
    </div>
  );
}

export function AdminScreen() {
  const { data } = useApp();
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  useEffect(() => { api<Record<string, unknown>>("/api/admin/overview").then(setOverview).catch(() => setOverview({ error: "Sin acceso" })); }, []);
  if (data && data.user.role !== "admin") return <p>Esta zona es solo para administración.</p>;
  const users = (overview?.users as Array<Record<string, unknown>>) || [];
  return (
    <div className="grid">
      <h1>Administración</h1>
      <div className="cards">
        <article className="card"><span className="kicker">Base</span><b>{String(overview?.db || "—")}</b></article>
        <article className="card"><span className="kicker">Posiciones</span><b>{String(overview?.openPositions ?? "—")}</b></article>
        <article className="card"><span className="kicker">Google</span><b>{overview?.google ? "configurado" : "no configurado"}</b></article>
      </div>
      <div className="row">
        <button className="btn btn-primary" type="button" onClick={async () => { const res = await api<{ code: string }>("/api/admin/invite", { method: "POST" }); setSecret(res.code); }}>Crear invitación</button>
        {secret ? <code>Código (se muestra una vez): {secret}</code> : null}
      </div>
      <form className="row" onSubmit={async (event) => { event.preventDefault(); await api("/api/admin/allow", { method: "POST", body: JSON.stringify({ email }) }); setEmail(""); }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo permitido en Google" type="email" required />
        <button className="btn" type="submit">Añadir a la lista</button>
      </form>
      {users.map((user) => (
        <div className="card row" key={String(user.id)}>
          <span>{String(user.username)} · {String(user.email)} · {String(user.role)}</span>
          <button className="btn" type="button" onClick={async () => { const res = await api<{ path: string }>("/api/admin/reset", { method: "POST", body: JSON.stringify({ userId: user.id }) }); setSecret(res.path); }}>Enlace de recuperación</button>
          {user.role !== "admin" ? <button className="btn" type="button" onClick={async () => { await api("/api/admin/user", { method: "POST", body: JSON.stringify({ userId: user.id, disabled: !user.disabled }) }); location.reload(); }}>{user.disabled ? "Activar" : "Desactivar"}</button> : null}
        </div>
      ))}
      <h2>Eventos</h2>
      {((overview?.events as Array<Record<string, unknown>>) || []).map((event, index) => <p key={index} className="fine">{String(event.level)} · {String(event.source)} · {String(event.message)}</p>)}
    </div>
  );
}
