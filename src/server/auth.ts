import { createHash, timingSafeEqual } from 'node:crypto';
import { logger } from '../logger.ts';

// ---------------------------------------------------------------------------
// Constant-time credential comparison
//
// `expectedPassword !== password` short-circuits on the first mismatch and
// leaks timing per-character. timingSafeEqual compares full buffers, but
// throws if lengths differ — so we hash both sides to a fixed 32-byte
// SHA-256 digest first. The hash also masks the password length.
// ---------------------------------------------------------------------------

function constantTimeEqual(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

// ---------------------------------------------------------------------------
// Failed-auth rate limiter
//
// Keyed by client IP (falls back to a shared bucket when the forwarded-for
// header is missing — defensive so a misconfigured proxy can't silently
// disable the limit). Tracks failures in a rolling window; once the cap
// is hit, the bucket is locked for the remainder of the window.
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000;
const MAX_FAILURES = 5;

interface Bucket {
  failures: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Periodic GC — prevents unbounded growth from one-off probe IPs.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > WINDOW_MS) {
      buckets.delete(key);
    }
  }
}, WINDOW_MS).unref?.();

function getClientKey(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

function isRateLimited(key: string): { limited: boolean; retryAfterMs: number } {
  const bucket = buckets.get(key);
  const now = Date.now();
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    return { limited: false, retryAfterMs: 0 };
  }
  if (bucket.failures >= MAX_FAILURES) {
    return { limited: true, retryAfterMs: WINDOW_MS - (now - bucket.windowStart) };
  }
  return { limited: false, retryAfterMs: 0 };
}

function recordFailure(key: string): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { failures: 1, windowStart: now });
    return;
  }
  bucket.failures++;
}

function recordSuccess(key: string): void {
  buckets.delete(key);
}

// ---------------------------------------------------------------------------
// Basic auth middleware
// ---------------------------------------------------------------------------

export interface AuthResult {
  user: { username: string } | null;
  rateLimited: boolean;
  retryAfterMs: number;
}

export function authenticate(
  request: Request,
  authConfig: Record<string, string>,
): AuthResult {
  const clientKey = getClientKey(request);

  const rate = isRateLimited(clientKey);
  if (rate.limited) {
    logger.warn('Auth rate limit hit', { clientKey, retryAfterMs: rate.retryAfterMs });
    return { user: null, rateLimited: true, retryAfterMs: rate.retryAfterMs };
  }

  const authHeader = request.headers.get('Authorization');
  if (authHeader === null || !authHeader.startsWith('Basic ')) {
    recordFailure(clientKey);
    return { user: null, rateLimited: false, retryAfterMs: 0 };
  }

  const base64 = authHeader.slice('Basic '.length);
  let decoded: string;
  try {
    decoded = atob(base64);
  } catch {
    recordFailure(clientKey);
    return { user: null, rateLimited: false, retryAfterMs: 0 };
  }

  const colonIndex = decoded.indexOf(':');
  if (colonIndex === -1) {
    recordFailure(clientKey);
    return { user: null, rateLimited: false, retryAfterMs: 0 };
  }

  const username = decoded.slice(0, colonIndex);
  const password = decoded.slice(colonIndex + 1);

  const expectedPassword = authConfig[username];
  if (expectedPassword === undefined || !constantTimeEqual(expectedPassword, password)) {
    recordFailure(clientKey);
    return { user: null, rateLimited: false, retryAfterMs: 0 };
  }

  recordSuccess(clientKey);
  return { user: { username }, rateLimited: false, retryAfterMs: 0 };
}

export function unauthorizedResponse(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Reviewer Dashboard"',
      'Content-Type': 'text/plain',
    },
  });
}

export function rateLimitedResponse(retryAfterMs: number): Response {
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
  return new Response('Too Many Requests', {
    status: 429,
    headers: {
      'Retry-After': String(retryAfterSeconds),
      'Content-Type': 'text/plain',
    },
  });
}
