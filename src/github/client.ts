import { logger } from '../logger';
import type { RateLimitState } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GITHUB_BASE_URL = 'https://api.github.com';

// ---------------------------------------------------------------------------
// Module-level rate limit state
// ---------------------------------------------------------------------------

const rateLimitState: RateLimitState = {
  remaining: 5000,
  resetAt: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateRateLimitFromHeaders(headers: Headers): void {
  const remaining = headers.get('X-RateLimit-Remaining');
  const reset = headers.get('X-RateLimit-Reset');

  if (remaining !== null) {
    rateLimitState.remaining = parseInt(remaining, 10);
  }
  if (reset !== null) {
    rateLimitState.resetAt = parseInt(reset, 10);
  }

  if (rateLimitState.remaining < 100) {
    logger.warn('GitHub rate limit running low', {
      remaining: rateLimitState.remaining,
      resetAt: new Date(rateLimitState.resetAt * 1000).toISOString(),
    });
  }
}

export async function backoffIfNeeded(): Promise<void> {
  if (rateLimitState.remaining < 100 && rateLimitState.resetAt > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    const waitSec = Math.max(0, rateLimitState.resetAt - nowSec) + 1;
    logger.warn('Rate limit low — backing off', { waitSeconds: waitSec });
    await new Promise<void>((resolve) => setTimeout(resolve, waitSec * 1000));
  }
}

// ---------------------------------------------------------------------------
// Core request function
// ---------------------------------------------------------------------------

export async function githubRequest(
  pat: string,
  method: string,
  path: string,
  options?: {
    body?: unknown;
    accept?: string;
  },
): Promise<Response> {
  await backoffIfNeeded();

  const url = path.startsWith('http') ? path : `${GITHUB_BASE_URL}${path}`;
  const accept = options?.accept ?? 'application/vnd.github+json';

  const headers: Record<string, string> = {
    Authorization: `Bearer ${pat}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  logger.debug('GitHub API request', { method, url });

  const response = await fetch(url, {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  updateRateLimitFromHeaders(response.headers);

  return response;
}

export async function githubRequestJson<T>(
  pat: string,
  method: string,
  path: string,
  options?: {
    body?: unknown;
    accept?: string;
  },
): Promise<T> {
  const response = await githubRequest(pat, method, path, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `GitHub API error ${response.status} ${response.statusText} for ${method} ${path}: ${errorText}`,
    );
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Rate limit initialisation
// ---------------------------------------------------------------------------

export async function checkRateLimit(pat: string): Promise<void> {
  const data = await githubRequestJson<{
    rate: { remaining: number; reset: number };
  }>(pat, 'GET', '/rate_limit');

  rateLimitState.remaining = data.rate.remaining;
  rateLimitState.resetAt = data.rate.reset;

  logger.info('GitHub rate limit initialised', {
    remaining: rateLimitState.remaining,
    resetAt: new Date(rateLimitState.resetAt * 1000).toISOString(),
  });
}

export function getRateLimitState(): Readonly<RateLimitState> {
  return rateLimitState;
}

// ---------------------------------------------------------------------------
// URL parser
// ---------------------------------------------------------------------------

export function parseRepoFromUrl(prUrl: string): { owner: string; repo: string; number: number } {
  // Matches: https://github.com/{owner}/{repo}/pull/{number}
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) {
    throw new Error(`Cannot parse GitHub PR URL: ${prUrl}`);
  }
  return {
    owner: match[1]!,
    repo: match[2]!,
    number: parseInt(match[3]!, 10),
  };
}
