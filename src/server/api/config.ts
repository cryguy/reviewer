import type { Config } from '../../config.ts';

// ---------------------------------------------------------------------------
// GET /api/config
// ---------------------------------------------------------------------------

export function handleGetConfig(_req: Request, config: Config): Response {
  const redacted = {
    ...config,
    bot: {
      ...config.bot,
      githubPAT: '***',
    },
    orchestrator: {
      ...config.orchestrator,
      apiKey: '***',
    },
    dashboard: {
      ...config.dashboard,
      auth: Object.fromEntries(
        Object.keys(config.dashboard.auth).map((username) => [username, '***']),
      ),
    },
  };

  return new Response(JSON.stringify(redacted), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
