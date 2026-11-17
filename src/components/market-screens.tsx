"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "./api";
import { PikasMark } from "./logo";
import { CandleChart, type CandlePoint } from "./chart";
import { useApp } from "./shell";
import { AnimatedNumber, PriceText, Skeleton, useToast } from "./ui";
import { ago, money, pct, signed } from "@/lib/format";
import { liquidationPrice } from "@/engine/trading";
import { ASSET_SYMBOLS } from "@/lib/symbols";

export function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(params.get("error") || "");
  const [google, setGoogle] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ configured: boolean }>("/api/auth/google/status").then((s) => setGoogle(s.configured)).catch(() => setGoogle(false));
  }, []);
  return (
    <form
      className="card auth-card"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        try {
          await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
          router.push("/");
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "No se pudo entrar");
        }
      }}
    >
      <PikasMark className="lg" />
      <p className="kicker">PIKAS</p>
      <h1>Entra a la simulación</h1>
      <p className="muted">Plataforma privada. Ninguna orden sale al mercado real.</p>
      <label className="field">Correo<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="username" /></label>
      <label className="field">Contraseña<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required autoComplete="current-password" /></label>
      {error ? <p className="down">{error}</p> : null}
      <button className="btn btn-primary" type="submit">Entrar</button>
      <button className="btn" type="button" disabled={google !== true} aria-describedby={google === false ? "google-off" : undefined} onClick={() => { if (google) window.location.href = "/api/auth/google/start"; }}>Continuar con Google</button>
      {google === false ? <p id="google-off" className="fine">Inicio con Google no configurado. Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor.</p> : null}
      <p className="fine"><Link href="/registro">Crear cuenta con invitación</Link> · <Link href="/recuperar">Recuperar acceso</Link></p>
    </form>
  );
}

export function RegisterScreen() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", username: "", password: "", inviteCode: "" });
  const [error, setError] = useState("");
  const [google, setGoogle] = useState(false);
  useEffect(() => { api<{ configured: boolean }>("/api/auth/google/status").then((s) => setGoogle(s.configured)).catch(() => setGoogle(false)); }, []);
  return (
    <form className="card auth-card" onSubmit={async (event) => {
      event.preventDefault();
      try {
        await api("/api/auth/register", { method: "POST", body: JSON.stringify(form) });
        router.push("/");
        router.refresh();
      } catch (err) { setError(err instanceof ApiError ? err.message : "No se pudo crear"); }
    }}>
      <h1>Crear cuenta</h1>
      <p className="muted">Hace falta invitación. El saldo que elijas después es ficticio.</p>
      {(["email", "username", "password", "inviteCode"] as const).map((key) => (
        <label className="field" key={key}>{key === "inviteCode" ? "Invitación" : key === "username" ? "Usuario" : key === "password" ? "Contraseña" : "Correo"}
          <input type={key === "password" ? "password" : "text"} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} required={key !== "inviteCode"} />
        </label>
      ))}
      {error ? <p className="down">{error}</p> : null}
      <button className="btn btn-primary" type="submit">Registrarme</button>
      <button className="btn" type="button" disabled={!google} aria-describedby={google ? undefined : "google-off-reg"} onClick={() => { if (google) window.location.href = `/api/auth/google/start?invite=${encodeURIComponent(form.inviteCode)}`; }}>Continuar con Google</button>
      {!google ? <p id="google-off-reg" className="fine">Inicio con Google no configurado. Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor.</p> : null}
      <Link href="/login">Ya tengo cuenta</Link>
    </form>
  );
}

export function RecoverScreen() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  if (token) {
    return (
      <form className="card auth-card" onSubmit={async (event) => {
        event.preventDefault();
        const res = await api<{ ok: boolean }>("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) });
        setMessage(res.ok ? "Contraseña actualizada. Ya puedes entrar." : "No se pudo");
      }}>
        <h1>Nueva contraseña</h1>
        <label className="field">Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required /></label>
        <button className="btn btn-primary" type="submit">Guardar</button>
        {message ? <p>{message}</p> : null}
      </form>
    );
  }
  return (
    <form className="card auth-card" onSubmit={async (event) => {
      event.preventDefault();
      const res = await api<{ message: string }>("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) });
      setMessage(res.message);
    }}>
      <h1>Recuperar acceso</h1>
      <p className="muted">No hay correo saliente configurado. Un administrador emite el enlace desde el panel.</p>
      <label className="field">Correo<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <button className="btn btn-primary" type="submit">Avisar</button>
      {message ? <p>{message}</p> : null}
      <Link href="/login">Volver</Link>
    </form>
  );
}

export function DashboardScreen() {
  const { data, loading } = useApp();
  if (loading || !data) return <div className="grid"><Skeleton className="sk-boot" /><Skeleton className="sk-boot" /></div>;
  const account = data.account;
  const pnl = account ? Number(account.equity) - Number(account.initialBalance) : null;
  return (
    <div className="grid">
      <div>
        <p className="kicker">Centro de operaciones</p>
        <h1>Hola, {data.user.username}</h1>
        <p className="muted">Precios de lectura. Cuentas, órdenes y resultados son simulación.</p>
      </div>
      {account?.catchupNote ? <div className="panel status-bad" role="status">{account.catchupNote}</div> : null}
      {data.quotes.every((quote) => !quote.price) ? <p className="panel status-bad" role="alert">No hay precios reales ahora. No se muestran cifras inventadas.</p> : null}
      <div className="cards">
        <article className="card"><span className="kicker">Saldo libre</span><b><AnimatedNumber value={account ? Number(account.balance) : null} format={(n) => money(n)} /></b></article>
        <article className="card"><span className="kicker">Patrimonio</span><b><AnimatedNumber value={account ? Number(account.equity) : null} format={(n) => money(n)} /></b></article>
        <article className="card"><span className="kicker">PnL</span><b className={pnl != null && pnl < 0 ? "down" : "up"}><AnimatedNumber value={pnl} format={(n) => signed(n)} /></b></article>
        <article className="card"><span className="kicker">Win rate</span><b>{account?.stats.winRate == null ? "—" : pct(account.stats.winRate * 100, 0)}</b><span className="fine">{account?.stats.trades || 0} cierres</span></article>
      </div>
      <div className="cards">
        {data.quotes.map((quote) => (
          <article className="card quote" key={quote.symbol}>
            <header><strong>{quote.symbol}</strong><span className="fine">{quote.name}</span></header>
            {quote.price ? <div className="price"><PriceText value={quote.price} digits={quote.kind === "crypto" ? 2 : 2} /></div> : <strong>No disponible</strong>}
            <span className={Number(quote.changeValue) < 0 ? "down" : "up"}>{quote.changeValue == null ? "variación n/d" : `${pct(quote.changeValue)} · ${quote.changeBasis === "24h" ? "24 h" : quote.changeBasis === "day_open" ? "apertura" : "cierre previo"}`}</span>
            <span className="fine">{quote.source || "sin fuente"} · {quote.status} · {ago(quote.providerTs || quote.fetchedAt)}</span>
            {quote.detail ? <span className="status-bad">{quote.detail}</span> : null}
          </article>
        ))}
      </div>
      <div className="quick">
        {[["Trading", "/trading"], ["Battle", "/battle"], ["Arena", "/arena"], ["Advisor", "/advisor"], ["PIKAS AI", "/pikas"]].map(([label, href]) => <Link className="card" key={href} href={href}>{label}</Link>)}
      </div>
    </div>
  );
}

export function TradingScreen() {
  const { data, refresh } = useApp();
  const toast = useToast();
  const [symbol, setSymbol] = useState("BTC");
  const [interval, setIntervalValue] = useState("1h");
  const [candles, setCandles] = useState<CandlePoint[]>([]);
  const [overlays, setOverlays] = useState<Array<{ ts: number; ema20: number | null; ema50: number | null }>>([]);
  const [note, setNote] = useState<string | null>(null);
  const [side, setSide] = useState<"long" | "short">("long");
  const [type, setType] = useState<"market" | "limit" | "stop_market">("market");
  const [margin, setMargin] = useState("10");
  const [leverage, setLeverage] = useState(2);
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const quote = data?.quotes.find((item) => item.symbol === symbol);
  useEffect(() => {
    api<{ candles: CandlePoint[]; indicators: Array<{ ts: number; ema20: number | null; ema50: number | null }>; error: string | null; source: string | null }>(`/api/market/candles?symbol=${symbol}&interval=${interval}`)
      .then((res) => { setCandles(res.candles || []); setOverlays(res.indicators || []); setNote(res.error ? `${res.error} Fuente: ${res.source || "n/d"}` : res.source); })
      .catch((err) => setNote(err.message));
  }, [symbol, interval]);
  const liq = quote?.price ? liquidationPrice(side, quote.price, leverage) : null;
  return (
    <div className="grid">
      <div className="row">
        <h1>Paper trading</h1>
        <div className="tabs" role="tablist" aria-label="Activo">{ASSET_SYMBOLS.map((item) => <button key={item} role="tab" aria-selected={symbol === item} className={symbol === item ? "chip on" : "chip"} type="button" onClick={() => setSymbol(item)}>{item}</button>)}</div>
        <div className="tabs">{["1m", "5m", "15m", "1h", "1d"].map((item) => <button key={item} className={interval === item ? "chip on" : "chip"} type="button" onClick={() => setIntervalValue(item)}>{item}</button>)}</div>
      </div>
      <div className="layout-trade">
        <section className="panel">
          <div className="row"><strong className="price"><PriceText value={quote?.price ?? null} /></strong><span className="fine">{quote?.source || "sin fuente"} · {quote?.status} · {ago(quote?.providerTs || quote?.fetchedAt || null)}</span></div>
          {note ? <p className="fine">{note}</p> : null}
          <CandleChart candles={candles} overlays={overlays} />
        </section>
        <form className="panel grid" onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api("/api/trading/order", { method: "POST", body: JSON.stringify({ symbol, side, type, margin, leverage, limitPrice: limitPrice || undefined, stopPrice: stopPrice || undefined }) });
            toast({ title: "Orden simulada enviada", tone: "ok" });
            await refresh();
          } catch (err) { toast({ title: "No se abrió", body: err instanceof Error ? err.message : "", tone: "danger" }); }
        }}>
          <div className="chips">{(["long", "short"] as const).map((item) => <button type="button" key={item} className={side === item ? "chip on" : "chip"} onClick={() => setSide(item)}>{item === "long" ? "Largo" : "Corto"}</button>)}</div>
          <div className="chips">{[1, 2, 3, 5, 10, 15, 20].map((item) => <button type="button" key={item} className={leverage === item ? "chip on" : "chip"} onClick={() => setLeverage(item)}>{item}x</button>)}</div>
          <p className="fine">A {leverage}x el precio de liquidación aproximado es {liq ? money(liq) : "—"}. El apalancamiento acerca ese nivel. Margen aislado.</p>
          <label className="field">Margen USDT<input value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="decimal" /></label>
          <label className="field">Tipo<select value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="market">Market</option><option value="limit">Limit</option><option value="stop_market">Stop market</option></select></label>
          {type === "limit" ? <label className="field">Precio límite<input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} /></label> : null}
          {type === "stop_market" ? <label className="field">Precio stop<input value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} /></label> : null}
          <button className="btn btn-primary" type="submit" disabled={!quote?.executable}>Enviar orden simulada</button>
          {!quote?.executable ? <p className="status-bad">El precio no es ejecutable. No se finge la ejecución.</p> : null}
        </form>
      </div>
      <section className="grid">
        <h2>Posiciones</h2>
        {(data?.account?.positions || []).length === 0 ? <p className="empty">No hay posiciones abiertas.</p> : null}
        <div className="cards">
          {(data?.account?.positions || []).map((position) => (
            <article className="card pos" key={String(position.id)}>
              <strong>{String(position.symbol)} · {String(position.side)}</strong>
              <dl>
                <div><dt>Entrada</dt><dd>{money(String(position.entryPrice))}</dd></div>
                <div><dt>Marca</dt><dd><PriceText value={position.mark as string | null} /></dd></div>
                <div><dt>PnL</dt><dd className={Number(position.upnl) < 0 ? "down" : "up"}>{position.upnl == null ? "n/d" : signed(String(position.upnl))}</dd></div>
                <div><dt>ROE</dt><dd>{position.roe == null ? "n/d" : pct(Number(position.roe) * 100)}</dd></div>
                <div><dt>Margen</dt><dd>{money(String(position.margin))}</dd></div>
                <div><dt>Liq.</dt><dd>{money(String(position.liquidation))}</dd></div>
                <div><dt>Estado marca</dt><dd>{String(position.markStatus)}</dd></div>
                <div><dt>Fuente</dt><dd>{String(position.markSource || "—")}</dd></div>
              </dl>
              <div className="row">
                <button className="btn" type="button" onClick={async () => { await api("/api/trading/close", { method: "POST", body: JSON.stringify({ positionId: position.id, percent: 50 }) }); await refresh(); }}>Cerrar 50%</button>
                <button className="btn" type="button" onClick={async () => { await api("/api/trading/close", { method: "POST", body: JSON.stringify({ positionId: position.id, percent: 100 }) }); await refresh(); }}>Cerrar</button>
              </div>
              <TpSl positionId={String(position.id)} onDone={refresh} />
            </article>
          ))}
        </div>
        <h2>Órdenes pendientes</h2>
        {(data?.account?.orders || []).map((order) => (
          <div className="row card" key={String(order.id)}>
            <span>{String(order.symbol)} {String(order.type)} {String(order.side)}</span>
            <button className="btn" type="button" onClick={async () => { await api("/api/trading/cancel", { method: "POST", body: JSON.stringify({ orderId: order.id }) }); await refresh(); }}>Cancelar</button>
          </div>
        ))}
      </section>
    </div>
  );
}

function TpSl({ positionId, onDone }: { positionId: string; onDone: () => Promise<void> }) {
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const toast = useToast();
  return (
    <form className="row" onSubmit={async (event) => {
      event.preventDefault();
      try {
        await api("/api/trading/tpsl", { method: "POST", body: JSON.stringify({ positionId, tp: tp || null, sl: sl || null }) });
        toast({ title: "TP/SL actualizados", tone: "ok" });
        await onDone();
      } catch (err) { toast({ title: "No se guardó", body: err instanceof Error ? err.message : "", tone: "danger" }); }
    }}>
      <input aria-label="Take profit" placeholder="Take profit" value={tp} onChange={(e) => setTp(e.target.value)} inputMode="decimal" />
      <input aria-label="Stop loss" placeholder="Stop loss" value={sl} onChange={(e) => setSl(e.target.value)} inputMode="decimal" />
      <button className="btn" type="submit">Guardar</button>
    </form>
  );
}
