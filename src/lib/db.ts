import { SCHEMA } from "./schema";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  kind: "pglite" | "postgres";
}

type PgliteLike = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  exec: (sql: string) => Promise<unknown>;
  transaction: <T>(fn: (tx: PgliteLike) => Promise<T>) => Promise<T>;
};

function wrapPglite(pg: PgliteLike, kind: Db["kind"] = "pglite"): Db {
  return {
    kind,
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const result = await pg.query(sql, params);
      return result.rows as T[];
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    async tx(fn) {
      return pg.transaction(async (tx) => fn(wrapPglite(tx, kind)));
    },
  };
}

export async function createMemoryDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  const db = wrapPglite(pg as unknown as PgliteLike);
  await migrate(db);
  return db;
}

async function createFileDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { mkdir } = await import("fs/promises");
  const dir = process.env.PIKAS_DATA_DIR || ".data/pglite";
  await mkdir(dir, { recursive: true });
  const pg = new PGlite(dir);
  const db = wrapPglite(pg as unknown as PgliteLike);
  await migrate(db);
  await ensureBaseline(db);
  return db;
}

async function createNeonDb(url: string): Promise<Db> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    ssl: url.includes("localhost") ? undefined : "require",
    idle_timeout: 20,
  });
  const wrap = (q: { unsafe: (text: string, params?: unknown[]) => Promise<unknown[]>; begin?: (fn: (tx: never) => Promise<unknown>) => Promise<unknown> }): Db => ({
    kind: "postgres",
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      return (await q.unsafe(text, params as never[])) as T[];
    },
    async exec(text) {
      await q.unsafe(text);
    },
    async tx(fn) {
      if ("begin" in q) {
        return (q as unknown as { begin: <T>(cb: (tx: typeof q) => Promise<T>) => Promise<T> }).begin(async (tx) => fn(wrap(tx)));
      }
      return fn(wrap(q));
    },
  });
  const db = wrap(sql as unknown as { unsafe: (text: string, params?: unknown[]) => Promise<unknown[]>; begin?: (fn: (tx: never) => Promise<unknown>) => Promise<unknown> });
  await migrate(db);
  await ensureBaseline(db);
  return db;
}

export async function migrate(db: Db): Promise<void> {
  await db.exec("create table if not exists schema_migrations (id text primary key, applied_at bigint not null)");
  const applied = await db.query<{ id: string }>("select id from schema_migrations");
  if (applied.some((row) => row.id === "001")) return;
  for (const statement of SCHEMA) {
    await db.exec(statement);
  }
  await db.query("insert into schema_migrations (id, applied_at) values ($1, $2)", ["001", Date.now()]);
}

async function ensureBaseline(db: Db): Promise<void> {
  const daily = process.env.AI_DAILY_BUDGET_USD || "1";
  const monthly = process.env.AI_MONTHLY_BUDGET_USD || "10";
  const existing = await db.query("select id from ai_budget where id = 1");
  if (!existing.length) {
    await db.query("insert into ai_budget (id, daily_usd, monthly_usd) values (1, $1, $2)", [daily, monthly]);
  }
  const agents = [
    ["baseline", "Baseline técnico", "rules", null, "Reglas EMA/RSI sobre velas reales. No es un modelo de lenguaje."],
    ["openai", "OpenAI", "llm", "openai", "Agente conectado al proveedor OpenAI si hay clave."],
    ["anthropic", "Anthropic", "llm", "anthropic", "Agente conectado a Anthropic si hay clave."],
    ["gemini", "Gemini", "llm", "gemini", "Agente conectado a Gemini si hay clave."],
    ["xai", "Grok", "llm", "xai", "Agente conectado a xAI si hay clave."],
  ] as const;
  for (const [slug, name, kind, provider, description] of agents) {
    const found = await db.query("select id from agents where slug = $1", [slug]);
    if (!found.length) {
      await db.query(
        "insert into agents (id, slug, name, kind, provider, description) values ($1,$2,$3,$4,$5,$6)",
        [crypto.randomUUID(), slug, name, kind, provider, description],
      );
    }
  }
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  const users = await db.query("select id from users limit 1");
  if (users.length) return;
  const { hashPassword } = await import("./auth");
  if (password.length < 10) throw new Error("BOOTSTRAP_ADMIN_PASSWORD debe tener al menos 10 caracteres.");
  const id = crypto.randomUUID();
  await db.query(
    `insert into users (id, email, username, password_hash, role, avatar_hue, disabled, created_at)
     values ($1,$2,$3,$4,'admin',$5,0,$6)`,
    [id, email, "admin", await hashPassword(password), hue(email), Date.now()],
  );
  await db.query(
    "insert into user_settings (user_id) values ($1) on conflict (user_id) do nothing",
    [id],
  );
}

function hue(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 33 + ch.charCodeAt(0)) % 360;
  return h;
}

const globalDb = globalThis as unknown as { __pikas?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalDb.__pikas) {
    globalDb.__pikas = (async () => {
      const url = process.env.DATABASE_URL;
      if (url) return createNeonDb(url);
      if (process.env.VERCEL || process.env.NODE_ENV === "production") {
        throw new Error("DATABASE_URL es obligatorio en producción. PIKAS no usa una base efímera en el hosting.");
      }
      return createFileDb();
    })();
  }
  return globalDb.__pikas;
}

export async function logEvent(db: Db, level: string, source: string, message: string, meta?: Record<string, unknown>) {
  const safe = meta
    ? JSON.stringify(meta, (key, value) => {
        if (/key|secret|password|token|authorization/i.test(key)) return "[omitido]";
        return value;
      })
    : null;
  await db.query(
    "insert into system_events (id, level, source, message, meta, created_at) values ($1,$2,$3,$4,$5,$6)",
    [crypto.randomUUID(), level, source, message.slice(0, 500), safe, Date.now()],
  );
}
