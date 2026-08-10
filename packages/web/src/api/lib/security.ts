import type { Context, Next } from "hono";

/**
 * Transport and abuse protections.
 *
 * 1. HTTPS is enforced everywhere in production (307 redirect + HSTS), while
 *    localhost and private LAN hosts are left alone so local development and
 *    sandbox previews still work over plain HTTP.
 * 2. Login endpoints are rate limited per IP and per account to blunt brute
 *    force and credential stuffing.
 * 3. Idle sessions are expired server-side, independently of the cookie TTL.
 *
 * Encryption at rest is provided by the managed Turso/libSQL database (AES-256
 * on the underlying volumes and on replicas) plus AES-256-GCM on every backup
 * artifact — it is deliberately not re-implemented in application code, which
 * would only move the key next to the data.
 */

/* ------------------------------------------------------------------ HTTPS */

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|.*\.local)(:\d+)?$/i;
const PRIVATE_HOST = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function isLocalHost(host: string | undefined): boolean {
  if (!host) return true;
  return LOCAL_HOST.test(host) || PRIVATE_HOST.test(host);
}

/**
 * Reports whether the *original* client request was already HTTPS.
 *
 * Behind a proxy the app itself is always reached over plain HTTP, so the
 * socket protocol says nothing. Only an explicit forwarded-protocol header is
 * evidence, and different edges spell it differently — Cloudflare, for one,
 * sends `cf-visitor` rather than `x-forwarded-proto`. When no header states the
 * scheme we must assume HTTPS: guessing "http" would bounce every request off a
 * proxy that never sets one, and a 307 on a POST silently breaks sign-in.
 */
function forwardedProto(c: Context): "https" | "http" | null {
  const forwarded = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded === "https" || forwarded === "http") return forwarded;

  /* Cloudflare: `cf-visitor: {"scheme":"https"}` */
  const visitor = c.req.header("cf-visitor");
  if (visitor?.includes('"https"')) return "https";
  if (visitor?.includes('"http"')) return "http";

  if (c.req.header("x-forwarded-ssl")?.toLowerCase() === "on") return "https";
  if (c.req.header("front-end-https")?.toLowerCase() === "on") return "https";

  return null;
}

/** Redirect http -> https and add HSTS. No-op for local/private hosts. */
export async function httpsOnly(c: Context, next: Next) {
  const host = c.req.header("host");
  if (isLocalHost(host)) return next();

  /* Only bounce when the edge positively tells us the hop was insecure, and
     only for navigations — redirecting an API POST would drop its body. */
  const proto = forwardedProto(c);
  const isNavigation = c.req.method === "GET" || c.req.method === "HEAD";
  if (proto === "http" && isNavigation) {
    const url = new URL(c.req.url);
    url.protocol = "https:";
    if (host) url.host = host;
    return c.redirect(url.toString(), 307);
  }

  await next();
  c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
}

/* ----------------------------------------------------------- rate limiting */

interface Window {
  hits: number;
  resetAt: number;
  blockedUntil: number;
}

const windows = new Map<string, Window>();

export interface RateLimitOptions {
  /** Attempts allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Lockout applied once the limit is exceeded. */
  blockMs: number;
}

export const LOGIN_LIMIT: RateLimitOptions = {
  limit: 8,
  windowMs: 10 * 60_000,
  blockMs: 15 * 60_000,
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function consume(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (existing && existing.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((existing.blockedUntil - now) / 1000),
    };
  }

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { hits: 1, resetAt: now + options.windowMs, blockedUntil: 0 });
    return { allowed: true, remaining: options.limit - 1, retryAfterSeconds: 0 };
  }

  existing.hits++;
  if (existing.hits > options.limit) {
    existing.blockedUntil = now + options.blockMs;
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil(options.blockMs / 1000) };
  }
  return { allowed: true, remaining: options.limit - existing.hits, retryAfterSeconds: 0 };
}

/** Clear the counter for a key — called after a successful sign-in. */
export function resetLimit(key: string) {
  windows.delete(key);
}

export function clientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-real-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/* --------------------------------------------------------- idle sessions */

const lastSeen = new Map<string, number>();

/** Prune the idle map so a long-running process cannot grow unbounded. */
function prune(maxAgeMs: number) {
  if (lastSeen.size < 5000) return;
  const cutoff = Date.now() - maxAgeMs;
  for (const [key, at] of lastSeen) if (at < cutoff) lastSeen.delete(key);
}

export interface IdleCheck {
  expired: boolean;
  idleSeconds: number;
}

/**
 * Record activity for a session and report whether it had already gone idle
 * past the agency's limit. `idleMinutes = 0` disables the check.
 */
export function touchSession(sessionId: string, idleMinutes: number): IdleCheck {
  const now = Date.now();
  if (idleMinutes <= 0) {
    lastSeen.set(sessionId, now);
    return { expired: false, idleSeconds: 0 };
  }

  const previous = lastSeen.get(sessionId);
  const idleSeconds = previous ? Math.round((now - previous) / 1000) : 0;
  const expired = previous != null && now - previous > idleMinutes * 60_000;

  if (expired) lastSeen.delete(sessionId);
  else lastSeen.set(sessionId, now);

  prune(idleMinutes * 60_000 * 4);
  return { expired, idleSeconds };
}

export function forgetSession(sessionId: string) {
  lastSeen.delete(sessionId);
}
