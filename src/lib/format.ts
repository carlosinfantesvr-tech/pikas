export function money(value: string | number | null | undefined, digits = 2): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function signed(value: string | number | null | undefined, digits = 2): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  const body = money(Math.abs(n), digits);
  if (n > 0) return `+${body}`;
  if (n < 0) return `−${body}`;
  return body;
}

export function pct(value: string | number | null | undefined, digits = 2): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  const body = new Intl.NumberFormat("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(n));
  if (n > 0) return `+${body}%`;
  if (n < 0) return `−${body}%`;
  return `${body}%`;
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return "sin marca de tiempo";
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 5) return "ahora";
  if (seconds < 60) return `hace ${seconds} s`;
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)} h`;
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(ts);
}

export function when(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(ts);
}
