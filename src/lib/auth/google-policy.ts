export interface AccessInput {
  email: string;
  emailVerified: boolean;
  existing: boolean;
  existingDisabled: boolean;
  allowlisted: boolean;
  inviteValid: boolean;
}

export type AccessDecision =
  | { ok: true; action: "login" | "create" }
  | { ok: false; code: "email_unverified" | "disabled" | "not_allowed"; message: string };

export function decideGoogleAccess(input: AccessInput): AccessDecision {
  if (!input.emailVerified) {
    return { ok: false, code: "email_unverified", message: "Google no ha verificado ese correo." };
  }
  if (input.existing) {
    if (input.existingDisabled) {
      return { ok: false, code: "disabled", message: "Esta cuenta está desactivada." };
    }
    return { ok: true, action: "login" };
  }
  if (input.allowlisted || input.inviteValid) {
    return { ok: true, action: "create" };
  }
  return {
    ok: false,
    code: "not_allowed",
    message: "Esta cuenta de Google no está autorizada. PIKAS es privado: hace falta invitación o estar en la lista.",
  };
}

export function googleOAuthConfigured(env: { clientId?: string; clientSecret?: string }): boolean {
  return Boolean(env.clientId && env.clientSecret);
}

export function buildGoogleAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("access_type", "online");
  return url.toString();
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export async function exchangeGoogleCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleProfile> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
  const tokenRes = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) {
    throw new Error(`Google rechazó el código (${tokenRes.status}).`);
  }
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("Google no devolvió access_token.");
  const infoRes = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!infoRes.ok) throw new Error(`No se pudo leer el perfil de Google (${infoRes.status}).`);
  const info = (await infoRes.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (!info.sub || !info.email) throw new Error("El perfil de Google no incluye correo.");
  return {
    sub: info.sub,
    email: info.email.toLowerCase(),
    emailVerified: info.email_verified === true,
    name: info.name || info.email,
  };
}
