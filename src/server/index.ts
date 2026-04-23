import type { Config } from '../config.ts';
import { logger } from '../logger.ts';
import { authenticate, unauthorizedResponse, rateLimitedResponse } from './auth.ts';
import { Router } from './router.ts';
import { handleGetQueue } from './api/queue.ts';
import { handleGetRuns, handleGetRunDetail } from './api/runs.ts';
import { handleGetConfig } from './api/config.ts';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Static file helpers
// ---------------------------------------------------------------------------

const DASHBOARD_DIST = path.resolve(process.cwd(), 'dashboard/dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

function serveStatic(urlPath: string): Response {
  // Sanitise path to prevent directory traversal
  const relativePath = urlPath.replace(/^\//, '');
  const resolved = path.resolve(DASHBOARD_DIST, relativePath);

  // Ensure resolved path is within dist directory
  if (!resolved.startsWith(DASHBOARD_DIST)) {
    return new Response('Forbidden', { status: 403 });
  }

  // Try to serve the exact file
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    const content = fs.readFileSync(resolved);
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': getMimeType(resolved) },
    });
  }

  // SPA fallback: serve index.html
  const indexPath = path.join(DASHBOARD_DIST, 'index.html');
  if (fs.existsSync(indexPath)) {
    const content = fs.readFileSync(indexPath);
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return new Response('Not Found', { status: 404 });
}

// ---------------------------------------------------------------------------
// Server lifecycle
//
// The dashboard SPA is served by this same origin, so CORS is not needed
// for its own requests. A permissive `Access-Control-Allow-Origin: *` would
// actively widen the attack surface (any site a signed-in teammate visits
// could trigger authenticated reads), so we omit CORS entirely. Cross-origin
// API clients are intentionally unsupported.
// ---------------------------------------------------------------------------

let server: ReturnType<typeof Bun.serve> | null = null;

export function startServer(config: Config): void {
  const router = new Router();

  // Register API routes
  router.get('/api/queue', (req) => handleGetQueue(req));
  router.get('/api/runs', (req) => handleGetRuns(req));
  router.get('/api/runs/:id', (req, params) =>
    handleGetRunDetail(req, params as { id: string }),
  );
  router.get('/api/config', (req) => handleGetConfig(req, config));

  const { port, auth } = config.dashboard;

  server = Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      // API routes require Basic auth
      if (url.pathname.startsWith('/api/')) {
        // Only enforce auth if credentials are configured
        if (Object.keys(auth).length > 0) {
          const result = authenticate(req, auth);
          if (result.rateLimited) {
            return rateLimitedResponse(result.retryAfterMs);
          }
          if (result.user === null) {
            return unauthorizedResponse();
          }
        }

        return router.handle(req);
      }

      // Non-API routes: serve static files
      return serveStatic(url.pathname);
    },
  });

  logger.info('Dashboard server started', { port });
}

export function stopServer(): void {
  if (server !== null) {
    server.stop();
    server = null;
    logger.info('Dashboard server stopped');
  }
}
