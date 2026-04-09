// ---------------------------------------------------------------------------
// Simple route matching
// ---------------------------------------------------------------------------

type RouteHandler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;

interface Route {
  method: string;
  pattern: string;
  segments: string[];
  handler: RouteHandler;
}

function parsePattern(pattern: string): string[] {
  return pattern.split('/').filter((s) => s.length > 0);
}

function matchRoute(
  route: Route,
  method: string,
  pathSegments: string[],
): Record<string, string> | null {
  if (route.method !== method) {
    return null;
  }
  if (route.segments.length !== pathSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < route.segments.length; i++) {
    const routeSeg = route.segments[i]!;
    const pathSeg = pathSegments[i]!;

    if (routeSeg.startsWith(':')) {
      params[routeSeg.slice(1)] = pathSeg;
    } else if (routeSeg !== pathSeg) {
      return null;
    }
  }

  return params;
}

export class Router {
  private routes: Route[] = [];

  get(pattern: string, handler: RouteHandler): void {
    this.routes.push({
      method: 'GET',
      pattern,
      segments: parsePattern(pattern),
      handler,
    });
  }

  post(pattern: string, handler: RouteHandler): void {
    this.routes.push({
      method: 'POST',
      pattern,
      segments: parsePattern(pattern),
      handler,
    });
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathSegments = url.pathname.split('/').filter((s) => s.length > 0);

    for (const route of this.routes) {
      const params = matchRoute(route, req.method, pathSegments);
      if (params !== null) {
        return route.handler(req, params);
      }
    }

    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }
}
