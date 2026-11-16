"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const MotionCtx = createContext(false);
export function MotionProvider({ children, off }: { children: React.ReactNode; off?: boolean }) {
  const [system, setSystem] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setSystem(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  const reduced = Boolean(off || system);
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "off" : "on";
  }, [reduced]);
  return <MotionCtx.Provider value={reduced}>{children}</MotionCtx.Provider>;
}
export function useReduced() {
  return useContext(MotionCtx);
}

export function AnimatedNumber({ value, format }: { value: number | null | undefined; format: (n: number) => string }) {
  const reduced = useReduced();
  const [shown, setShown] = useState(value ?? 0);
  const from = useRef(value ?? 0);
  useEffect(() => {
    if (value == null || !Number.isFinite(value)) return;
    if (reduced) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    const end = value;
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 680);
      const eased = 1 - (1 - p) ** 3;
      setShown(start + (end - start) * eased);
      if (p < 1) frame = requestAnimationFrame(tick);
      else from.current = end;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  if (value == null || !Number.isFinite(value)) return <>—</>;
  return <>{format(shown)}</>;
}

export function PriceText({ value, digits = 2 }: { value: string | number | null; digits?: number }) {
  const reduced = useReduced();
  const prev = useRef<number | null>(null);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const n = value == null || value === "" ? null : Number(value);
  useEffect(() => {
    if (n == null || !Number.isFinite(n)) return;
    if (prev.current != null && n !== prev.current) setDir(n > prev.current ? "up" : "down");
    prev.current = n;
    const id = window.setTimeout(() => setDir(null), 720);
    return () => window.clearTimeout(id);
  }, [n]);
  const text = n == null || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  return <span className={!reduced && dir ? `tick tick-${dir}` : undefined}>{text}</span>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden />;
}

export function FlipList({ items, render }: { items: Array<{ id: string } & Record<string, unknown>>; render: (item: { id: string } & Record<string, unknown>, index: number) => React.ReactNode }) {
  const reduced = useReduced();
  const refs = useRef(new Map<string, HTMLDivElement>());
  const prev = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    refs.current.forEach((el, id) => next.set(id, el.getBoundingClientRect().top));
    if (!reduced) {
      refs.current.forEach((el, id) => {
        const first = prev.current.get(id);
        const last = next.get(id);
        if (first == null || last == null || first === last) return;
        el.animate(
          [{ transform: `translateY(${first - last}px)` }, { transform: "translateY(0)" }],
          { duration: 480, easing: "cubic-bezier(.2,.75,.2,1)" },
        );
      });
    }
    prev.current = next;
  }, [items, reduced]);
  return (
    <div className="stack">
      {items.map((item, index) => (
        <div key={item.id} ref={(node) => { if (node) refs.current.set(item.id, node); else refs.current.delete(item.id); }} className="flip-item">
          {render(item, index)}
        </div>
      ))}
    </div>
  );
}

type Toast = { id: string; title: string; body?: string; tone?: "info" | "ok" | "danger" };
const ToastCtx = createContext<(toast: Omit<Toast, "id">) => void>(() => {});
export function useToast() {
  return useContext(ToastCtx);
}
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (toast: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-2), { ...toast, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  };
  const value = useMemo(() => push, []);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone || "info"}`} role="status">
            <strong>{toast.title}</strong>
            {toast.body ? <p>{toast.body}</p> : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
