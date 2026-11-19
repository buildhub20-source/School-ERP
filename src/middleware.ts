import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "./lib/rate-limit";

const dev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy with a fresh nonce per request: only scripts carrying the nonce (Next.js adds it to its own
 * scripts and to <Script>) run, plus scripts they load ('strict-dynamic', e.g. Razorpay checkout). Inline scripts injected
 * by an attacker have no nonce and are blocked. Own origin + OpenStreetMap tiles + Razorpay for everything else.
 */
function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://checkout.razorpay.com${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.razorpay.com",
    "font-src 'self' data:",
    `connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com${dev ? " ws: wss:" : ""}`,
    "frame-src https://api.razorpay.com https://checkout.razorpay.com",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Pass the request on with the nonce (Next.js reads it from the request's CSP header) and send the policy to the browser. */
function next(req: NextRequest, extra: Record<string, string> = {}) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

const PUBLIC = ["/login", "/verify", "/api/payments/webhook", "/api/auth", "/manifest.webmanifest", "/sw.js", "/icon", "/offline"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Sign-in attempts (password, OTP, 2-step): at most 30 per IP per 10 minutes, on top of per-account and per-phone limits.
  if (req.method === "POST" && (pathname.startsWith("/login") || pathname.startsWith("/api/auth/login") || pathname.startsWith("/api/auth/otp"))) {
    // The client can put anything in X-Forwarded-For, so never use its first (left-most) entry. Use X-Real-IP (set by the
    // proxy, see README) or else the right-most entry, which is the one added by our own proxy.
    const ip = req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() || "local";
    const r = rateLimit(`auth:${ip}`, 30, 10 * 60000);
    if (!r.ok) return new NextResponse("Too many sign-in attempts. Please wait a few minutes and try again.", { status: 429, headers: { "retry-after": String(r.retryAfter) } });
  }
  if (PUBLIC.some((p) => pathname.startsWith(p)) || pathname.startsWith("/_next") || pathname.startsWith("/uploads/public")) return next(req);
  if (!req.cookies.get("sms_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return next(req, { "x-pathname": pathname });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|jpeg|webp|ico)$).*)"] };
