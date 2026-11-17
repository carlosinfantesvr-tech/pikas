import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";
import type { Db } from "./db";
import { decideGoogleAccess } from "./auth/google-policy";

const scrypt = promisify(scryptCb);
export const COOKIE = process.env.SESSION_COOKIE_NAME || "pikas_session";

export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string | null;
  role: "admin" | "user";
  google_sub: string | null;
  avatar_hue: number;
  disabled: number;
  created_at: number;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const key = (await scrypt(password, salt, 32)) as Buffer;
  const a = Buffer.from(hash, "base64url");
  if (a.length !== key.length) return false;
  return timingSafeEqual(a, key);
}

function hue(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 33 + ch.charCodeAt(0)) % 360;
  return h;
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    avatarHue: user.avatar_hue,
    createdAt: Number(user.created_at),
    hasPassword: Boolean(user.password_hash),
    hasGoogle: Boolean(user.google_sub),
  };
}

async function rateLimit(db: Db, key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const rows = await db.query<{ window_start: number; count: number }>("select window_start, count from rate_limits where key = $1", [key]);
  const row = rows[0];
  if (!row || now - Number(row.window_start) > windowMs) {
    await db.query(
      `insert into rate_limits (key, window_start, count) values ($1,$2,1)
       on conflict (key) do update set window_start = $2, count = 1`,
      [key, now],
    );
    return true;
  }
  if (Number(row.count) >= limit) return false;
  await db.query("update rate_limits set count = count + 1 where key = $1", [key]);
  return true;
}

export async function createInvite(db: Db, adminId: string, maxUses = 5, note?: string, ttlMs?: number): Promise<string> {
  const code = randomBytes(6).toString("base64url");
  await db.query(
    `insert into invites (id, code_hash, created_by, max_uses, uses, expires_at, note, created_at)
     values ($1,$2,$3,$4,0,$5,$6,$7)`,
    [crypto.randomUUID(), sha256(code), adminId, maxUses, ttlMs ? Date.now() + ttlMs : null, note ?? null, Date.now()],
  );
  return code;
}

async function consumeInvite(db: Db, code: string | undefined | null): Promise<boolean> {
  if (!code) return false;
  const rows = await db.query<{ id: string; uses: number; max_uses: number; expires_at: number | null }>(
    "select id, uses, max_uses, expires_at from invites where code_hash = $1",
    [sha256(code.trim())],
  );
  const invite = rows[0];
  if (!invite) return false;
  if (invite.expires_at && Number(invite.expires_at) < Date.now()) return false;
  if (Number(invite.uses) >= Number(invite.max_uses)) return false;
  await db.query("update invites set uses = uses + 1 where id = $1 and uses < max_uses", [invite.id]);
  return true;
}

export async function registerUser(
  db: Db,
  input: { email: string; username: string; password: string; inviteCode?: string },
): Promise<{ ok: true; user: UserRow } | { ok: false; error: string; code: string }> {
  const email = input.email.toLowerCase().trim();
  const username = input.username.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Correo no válido.", code: "BAD_EMAIL" };
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return { ok: false, error: "El usuario debe tener 3-20 caracteres (letras, números o _).", code: "BAD_USERNAME" };
  if (input.password.length < 10) return { ok: false, error: "La contraseña debe tener al menos 10 caracteres.", code: "BAD_PASSWORD" };
  const exists = await db.query("select id from users where email = $1 or username = $2", [email, username]);
  if (exists.length) return { ok: false, error: "Ese correo o usuario ya existe.", code: "EXISTS" };
  const inviteRequired = process.env.INVITE_REQUIRED !== "false";
  if (inviteRequired) {
    const ok = await consumeInvite(db, input.inviteCode);
    if (!ok) return { ok: false, error: "Hace falta una invitación válida. PIKAS es privado.", code: "INVITE" };
  }
  const user: UserRow = {
    id: crypto.randomUUID(),
    email,
    username,
    password_hash: await hashPassword(input.password),
    role: "user",
    google_sub: null,
    avatar_hue: hue(username),
    disabled: 0,
    created_at: Date.now(),
  };
  await db.query(
    `insert into users (id, email, username, password_hash, role, avatar_hue, disabled, created_at)
     values ($1,$2,$3,$4,$5,$6,0,$7)`,
    [user.id, user.email, user.username, user.password_hash, user.role, user.avatar_hue, user.created_at],
  );
  await db.query("insert into user_settings (user_id) values ($1) on conflict (user_id) do nothing", [user.id]);
  return { ok: true, user };
}

export async function loginUser(
  db: Db,
  input: { email: string; password: string; ip?: string },
): Promise<{ ok: true; user: UserRow } | { ok: false; error: string; code: string }> {
  const email = input.email.toLowerCase().trim();
  const allowed = await rateLimit(db, `login:${input.ip || "local"}:${email}`, 8, 10 * 60 * 1000);
  if (!allowed) return { ok: false, error: "Demasiados intentos. Espera unos minutos.", code: "RATE" };
  const rows = await db.query<UserRow>("select * from users where email = $1", [email]);
  const user = rows[0];
  const valid = await verifyPassword(input.password, user?.password_hash ?? null);
  if (!user || !valid) return { ok: false, error: "Correo o contraseña incorrectos.", code: "BAD_LOGIN" };
  if (user.disabled) return { ok: false, error: "Esta cuenta está desactivada.", code: "DISABLED" };
  if (!user.password_hash) return { ok: false, error: "Esta cuenta entra con Google.", code: "GOOGLE_ONLY" };
  return { ok: true, user };
}

export async function createSession(db: Db, userId: string, ua?: string, ip?: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expires = Date.now() + 30 * 24 * 3600 * 1000;
  await db.query(
    "insert into sessions (token_hash, user_id, expires_at, created_at, user_agent, ip) values ($1,$2,$3,$4,$5,$6)",
    [sha256(token), userId, expires, Date.now(), ua?.slice(0, 200) ?? null, ip ?? null],
  );
  return token;
}

export async function userFromToken(db: Db, token: string | null | undefined): Promise<UserRow | null> {
  if (!token) return null;
  const rows = await db.query<UserRow>(
    `select u.* from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > $2 and u.disabled = 0`,
    [sha256(token), Date.now()],
  );
  return rows[0] ?? null;
}

export async function destroySession(db: Db, token: string | null | undefined): Promise<void> {
  if (!token) return;
  await db.query("delete from sessions where token_hash = $1", [sha256(token)]);
}

export function readCookie(req: Request, name = COOKIE): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function requestPasswordReset(db: Db, email: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  const rows = await db.query<{ id: string }>("select id from users where email = $1", [normalized]);
  const user = rows[0];
  if (!user) return;
  const admins = await db.query<{ id: string }>("select id from users where role = 'admin'");
  for (const admin of admins) {
    await db.query(
      "insert into notifications (id, user_id, category, title, body, created_at) values ($1,$2,'sistema',$3,$4,$5)",
      [crypto.randomUUID(), admin.id, "Solicitud de recuperación", `El usuario ${normalized} pidió restablecer la contraseña.`, Date.now()],
    );
  }
  const { logEvent } = await import("./db");
  await logEvent(db, "info", "auth", "Solicitud de recuperación registrada", { email: email.toLowerCase() });
}

export async function issueResetToken(db: Db, userId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db.query(
    "insert into password_resets (id, user_id, token_hash, expires_at, created_at) values ($1,$2,$3,$4,$5)",
    [crypto.randomUUID(), userId, sha256(token), Date.now() + 3600_000, Date.now()],
  );
  return token;
}

export async function resetPassword(db: Db, token: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (password.length < 10) return { ok: false, error: "La contraseña debe tener al menos 10 caracteres." };
  const rows = await db.query<{ id: string; user_id: string }>(
    "select id, user_id from password_resets where token_hash = $1 and used_at is null and expires_at > $2",
    [sha256(token), Date.now()],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "El enlace no es válido o ha caducado." };
  await db.query("update users set password_hash = $1 where id = $2", [await hashPassword(password), row.user_id]);
  await db.query("update password_resets set used_at = $1 where id = $2", [Date.now(), row.id]);
  await db.query("delete from sessions where user_id = $1", [row.user_id]);
  return { ok: true };
}

export function allowlistFromEnv(): string[] {
  return (process.env.GOOGLE_ALLOWED_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export async function isAllowlisted(db: Db, email: string): Promise<boolean> {
  if (allowlistFromEnv().includes(email.toLowerCase())) return true;
  const rows = await db.query("select email from google_allowlist where email = $1", [email.toLowerCase()]);
  return rows.length > 0;
}

export async function completeGoogleProfile(
  db: Db,
  profile: { sub: string; email: string; emailVerified: boolean; name: string },
  inviteCode?: string | null,
): Promise<{ ok: true; user: UserRow } | { ok: false; error: string; code: string }> {
  const email = profile.email.toLowerCase();
  const bySub = await db.query<UserRow>("select * from users where google_sub = $1", [profile.sub]);
  const byEmail = bySub[0] ? bySub : await db.query<UserRow>("select * from users where email = $1", [email]);
  const existing = byEmail[0];
  const allowlisted = await isAllowlisted(db, email);
  const decision = decideGoogleAccess({
    email,
    emailVerified: profile.emailVerified,
    existing: Boolean(existing),
    existingDisabled: Boolean(existing?.disabled),
    allowlisted,
    inviteValid: false,
    registrationOpen: process.env.INVITE_REQUIRED === "false",
  });
  if (!decision.ok && decision.code === "not_allowed") {
    const consumed = await consumeInvite(db, inviteCode);
    if (!consumed) return { ok: false, error: decision.message, code: decision.code };
  } else if (!decision.ok) {
    return { ok: false, error: decision.message, code: decision.code };
  }
  if (existing) {
    if (!existing.google_sub) {
      await db.query("update users set google_sub = $1 where id = $2", [profile.sub, existing.id]);
      existing.google_sub = profile.sub;
    } else if (existing.google_sub !== profile.sub) {
      return { ok: false, error: "Ese correo ya está vinculado a otra identidad de Google.", code: "CONFLICT" };
    }
    return { ok: true, user: existing };
  }
  let username = profile.name.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16) || "usuario";
  if (username.length < 3) username = `u${username}${profile.sub.slice(0, 4)}`.slice(0, 20);
  const taken = await db.query("select id from users where username = $1", [username]);
  if (taken.length) username = `${username.slice(0, 12)}_${profile.sub.slice(0, 4)}`.slice(0, 20);
  const user: UserRow = {
    id: crypto.randomUUID(),
    email,
    username,
    password_hash: null,
    role: "user",
    google_sub: profile.sub,
    avatar_hue: hue(email),
    disabled: 0,
    created_at: Date.now(),
  };
  await db.query(
    `insert into users (id, email, username, password_hash, role, google_sub, avatar_hue, disabled, created_at)
     values ($1,$2,$3,null,'user',$4,$5,0,$6)`,
    [user.id, user.email, user.username, user.google_sub, user.avatar_hue, user.created_at],
  );
  await db.query("insert into user_settings (user_id) values ($1) on conflict (user_id) do nothing", [user.id]);
  return { ok: true, user };
}

export async function saveOauthState(db: Db, state: string, inviteCode: string | null, nextPath: string, codeVerifier: string): Promise<void> {
  await db.query(
    "insert into oauth_states (state_hash, invite_code, next_path, expires_at, created_at, code_verifier) values ($1,$2,$3,$4,$5,$6)",
    [sha256(state), inviteCode, nextPath, Date.now() + 10 * 60 * 1000, Date.now(), codeVerifier],
  );
}

export async function takeOauthState(
  db: Db,
  state: string,
): Promise<{ invite_code: string | null; next_path: string | null; code_verifier: string | null } | null> {
  const rows = await db.query<{ invite_code: string | null; next_path: string | null; code_verifier: string | null }>(
    "select invite_code, next_path, code_verifier from oauth_states where state_hash = $1 and expires_at > $2",
    [sha256(state), Date.now()],
  );
  await db.query("delete from oauth_states where state_hash = $1", [sha256(state)]);
  return rows[0] ?? null;
}
