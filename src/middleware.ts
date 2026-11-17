import { NextResponse, type NextRequest } from "next/server";

const COOKIE = process.env.SESSION_COOKIE_NAME || "pikas_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icons") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  const publicPage = ["/login", "/registro", "/recuperar", "/verificar", "/offline", "/u"].some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const publicApi = pathname === "/api/health" || pathname.startsWith("/api/auth/") || pathname === "/api/cron/tick" || pathname.startsWith("/api/public/");
  if (publicPage || publicApi) return NextResponse.next();
  if (!req.cookies.get(COOKIE)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "No autenticado", code: "UNAUTHENTICATED" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
