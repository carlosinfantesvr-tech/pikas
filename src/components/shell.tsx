"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { PikasChat, PikasMark } from "./pikas-chat";
import { AnimatedNumber, MotionProvider, PriceText, Skeleton, ToastProvider, useToast } from "./ui";
import { money, signed } from "@/lib/format";

export interface Quote {
  symbol: string;
  name: string;
  price: string | null;
  changeValue: string | null;
  changeBasis: string | null;
  source: string | null;
  status: string;
  executable: boolean;
  fetchedAt: number | null;
  providerTs: number | null;
  detail: string | null;
  kind: string;
}

interface Account {
  balance: string;
  equity: string;
  initialBalance: string;
  positions: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  stats: { trades: number; winRate: number | null; best: number | null; worst: number | null };
  catchupNote: string | null;
}

interface Bootstrap {
  user: { id: string; email: string; username: string; role: "admin" | "user"; avatarHue: number };
  account: Account | null;
  quotes: Quote[];
  unread: number;
  ai: { configured: boolean; providers: Array<{ id: string; label: string; configured: boolean }> };
  settings: { reduce_motion?: number; alert_move_pct?: string; autonomous_enabled?: number } | null;
}

interface AppState {
  data: Bootstrap | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppState>({ data: null, loading: true, refresh: async () => {} });
export function useApp() {
  return useContext(Ctx);
}

const NAV = [
  { href: "/", label: "Inicio" },
  { href: "/trading", label: "Trading" },
  { href: "/battle", label: "Battle" },
  { href: "/arena", label: "Arena" },
  { href: "/advisor", label: "Advisor" },
  { href: "/pikas", label: "PIKAS AI" },
  { href: "/rankings", label: "Rankings" },
  { href: "/historial", label: "Historial" },
  { href: "/alertas", label: "Alertas" },
  { href: "/router", label: "Router" },
  { href: "/perfil", label: "Perfil" },
  { href: "/ajustes", label: "Ajustes" },
];

function Frame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [chat, setChat] = useState(false);
  const [setup, setSetup] = useState<string>("100");
  const [install, setInstall] = useState<null | "ios" | "native">(null);
  const [promptEvent, setPromptEvent] = useState<{ prompt: () => Promise<void> } | null>(null);
  const auth = pathname === "/login" || pathname === "/registro" || pathname.startsWith("/recuperar");

  async function refresh() {
    const next = await api<Bootstrap>("/api/bootstrap");
    setData(next);
    setLoading(false);
  }

  useEffect(() => {
    if (auth) return;
    refresh().catch(() => router.push("/login"));
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      api<Bootstrap & { skipped?: boolean }>("/api/pulse", { method: "POST" })
        .then((pulse) => {
          setData((current) => current ? { ...current, quotes: pulse.quotes || current.quotes, account: pulse.account || current.account, unread: pulse.unread ?? current.unread } : current);
        })
        .catch(() => undefined);
    };
    const id = window.setInterval(tick, 15000);
    return () => window.clearInterval(id);
  }, [auth, pathname, router]);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    if (window.matchMedia("(display-mode: standalone)").matches || localStorage.getItem("pikas-install-hide") === "1") return;
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as Event & { prompt: () => Promise<void> });
      setInstall("native");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const ios = /iphone|ipad/i.test(navigator.userAgent);
    if (ios) setInstall("ios");
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (auth) {
    return (
      <MotionProvider>
        <div className="auth-bg">{children}</div>
      </MotionProvider>
    );
  }

  const equity = data?.account ? Number(data.account.equity) : null;
  const pnl = data?.account ? Number(data.account.equity) - Number(data.account.initialBalance) : null;
  const live = data?.quotes.some((quote) => quote.executable) ?? false;

  return (
    <MotionProvider off={Boolean(data?.settings?.reduce_motion)}>
      <Ctx.Provider value={{ data, loading, refresh }}>
        <div className="app">
          <a className="skip" href="#contenido">Saltar al contenido</a>
          <aside className="side">
            <Link href="/" className="brand">
              <PikasMark live={live} />
              <span>PIKAS</span>
            </Link>
            <nav>
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className={pathname === item.href ? "active" : ""}>{item.label}</Link>
              ))}
              {data?.user.role === "admin" ? <Link href="/admin" className={pathname === "/admin" ? "active" : ""}>Admin</Link> : null}
            </nav>
            <p className="side-note">Simulación educativa. Sin dinero real.</p>
          </aside>
          <div className="workspace">
            <header className="topbar">
              <div className="brand mobile-brand"><PikasMark live={live} /><b>PIKAS</b></div>
              <div className={`conn ${live ? "live" : "down"}`} role="status" aria-label={live ? "Precios en vivo" : "Sin precio ejecutable"}><span className="conn-long">{live ? "Precios en vivo" : "Sin precio ejecutable"}</span></div>
              <div className="equity-pill">
                <span>Patrimonio</span>
                <strong><AnimatedNumber value={equity} format={(n) => `${money(n)} USDT`} /></strong>
                <em className={pnl != null && pnl < 0 ? "down" : "up"}><AnimatedNumber value={pnl} format={(n) => signed(n)} /></em>
              </div>
              <Link href="/alertas" className="icon-btn" aria-label="Alertas">{data?.unread ? <i>{data.unread}</i> : null}●</Link>
              <Link href="/perfil" className="avatar" style={{ background: `hsl(${data?.user.avatarHue ?? 200} 70% 45%)` }}>{data?.user.username.slice(0, 1).toUpperCase()}</Link>
            </header>
            <main id="contenido" className="page-enter" key={pathname}>{children}</main>
          </div>
          {install ? (
            <div className="install" role="region" aria-label="Instalar PIKAS">
              <p>{install === "ios" ? "En iPhone: pulsa Compartir y luego Añadir a pantalla de inicio." : "PIKAS se puede instalar como aplicación."}</p>
              <div className="row">
                {install === "native" && promptEvent ? <button className="btn btn-primary" type="button" onClick={() => { void promptEvent.prompt(); setInstall(null); }}>Instalar</button> : null}
                <button className="btn" type="button" onClick={() => { localStorage.setItem("pikas-install-hide", "1"); setInstall(null); }}>Ahora no</button>
              </div>
            </div>
          ) : null}
          <nav className="tabbar" aria-label="Navegación principal">
            <Link href="/" className={pathname === "/" ? "active" : ""}>Inicio</Link>
            <Link href="/trading" className={pathname === "/trading" ? "active" : ""}>Trading</Link>
            <Link href="/battle" className={pathname === "/battle" ? "active" : ""}>Battle</Link>
            <Link href="/arena" className={pathname === "/arena" ? "active" : ""}>Arena</Link>
            <button type="button" onClick={() => setMore(true)}>Más</button>
          </nav>
          <button className="fab" type="button" onClick={() => setChat(true)} aria-label="Abrir PIKAS AI"><PikasMark /></button>
          {more ? (
            <div className="sheet-backdrop" onClick={() => setMore(false)}>
              <div className="sheet" onClick={(event) => event.stopPropagation()}>
                <h2>Más</h2>
                {NAV.slice(4).map((item) => <Link key={item.href} href={item.href} onClick={() => setMore(false)}>{item.label}</Link>)}
                {data?.user.role === "admin" ? <Link href="/admin" onClick={() => setMore(false)}>Admin</Link> : null}
                <button className="btn" type="button" onClick={() => { setMore(false); setChat(true); }}>Hablar con PIKAS AI</button>
              </div>
            </div>
          ) : null}
          {chat ? (
            <div className="sheet-backdrop" onClick={() => setChat(false)}>
              <div className="drawer" onClick={(event) => event.stopPropagation()}>
                <button className="btn ghost close-x" type="button" onClick={() => setChat(false)}>Cerrar</button>
                <PikasChat compact />
              </div>
            </div>
          ) : null}
          {data && !data.account ? (
            <div className="sheet-backdrop">
              <form
                className="sheet setup"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await api("/api/trading/account", { method: "POST", body: JSON.stringify({ initial: setup }) });
                  toast({ title: "Cuenta simulada creada", tone: "ok" });
                  await refresh();
                }}
              >
                <h2>Elige un saldo simulado</h2>
                <p>USDT ficticios. Puedes reiniciarlos después. No hay depósito ni broker.</p>
                <div className="chips">
                  {["10", "50", "100", "500"].map((amount) => (
                    <button type="button" key={amount} className={setup === amount ? "chip on" : "chip"} onClick={() => setSetup(amount)}>{amount}</button>
                  ))}
                </div>
                <button className="btn btn-primary" type="submit">Empezar con {setup} USDT</button>
              </form>
            </div>
          ) : null}
          {loading && !data ? <div className="boot"><Skeleton className="sk-boot" /></div> : null}
        </div>
      </Ctx.Provider>
    </MotionProvider>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <Frame>{children}</Frame>
    </ToastProvider>
  );
}
