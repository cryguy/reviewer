import { loadConfig } from './config';
import { logger } from './logger';
import { getDb } from './db';
import { recoverInterruptedRuns } from './db/queue';
import { checkRateLimit } from './github/client';
import { startPoller, stopPoller } from './polling/poller';
import { startQueueProcessor, stopQueueProcessor } from './queue/manager';
import { startServer, stopServer } from './server';

// Swallow a known race in ai-sdk-provider-codex-app-server where a ReadableStream
// controller is closed twice during post-run cleanup. The stack always originates
// from that package. Anything else we still treat as fatal so PM2 can restart.
function isKnownCodexStreamRace(err: Error & { code?: string }): boolean {
  return (
    err.code === 'ERR_INVALID_STATE' &&
    typeof err.stack === 'string' &&
    err.stack.includes('ai-sdk-provider-codex-app-server')
  );
}

process.on('uncaughtException', (err: Error & { code?: string }) => {
  if (isKnownCodexStreamRace(err)) {
    logger.warn('Ignored codex provider stream-close race', { error: err.message });
    return;
  }
  logger.error('Uncaught exception — exiting for PM2 restart', {
    error: err.message,
    code: err.code,
    stack: err.stack,
  });
  setTimeout(() => process.exit(1), 100).unref();
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  const withCode = err as Error & { code?: string };
  if (isKnownCodexStreamRace(withCode)) {
    logger.warn('Ignored codex provider stream-close race (unhandled rejection)', {
      error: err.message,
    });
    return;
  }
  logger.error('Unhandled rejection — exiting for PM2 restart', {
    reason: err.message,
    stack: err.stack,
  });
  setTimeout(() => process.exit(1), 100).unref();
});

async function main() {
  try {
    // 1. Load and validate config
    const config = loadConfig();
    logger.info('Configuration loaded successfully');

    // 2. Initialize SQLite database (creates tables if needed)
    const db = getDb();
    logger.info('Database initialized');

    // 3. Recovery: find RUNNING jobs → clean up partial clones → reset to QUEUED
    const recovered = recoverInterruptedRuns(config.bot.cloneBasePath);
    if (recovered.length > 0) {
      logger.info('Recovered interrupted runs', { count: recovered.length });
    }

    // 4. Check GitHub rate limit (cold start)
    await checkRateLimit(config.bot.githubPAT);
    logger.info('GitHub rate limit checked');

    // 5. Start notification polling
    startPoller(config);
    logger.info('Notification poller started', { intervalSeconds: config.bot.pollIntervalSeconds });

    // 6. Start queue processor
    startQueueProcessor(config);
    logger.info('Queue processor started');

    // 7. Start HTTP server (dashboard API + SPA)
    startServer(config);
    logger.info('Reviewer Bot started', {
      port: config.dashboard.port,
      username: config.bot.githubUsername,
      whitelist: config.whitelist,
    });

    // Graceful shutdown
    process.on('SIGINT', () => shutdown());
    process.on('SIGTERM', () => shutdown());

    function shutdown() {
      logger.info('Shutting down...');
      stopPoller();
      stopQueueProcessor();
      stopServer();
      logger.info('Shutdown complete');
      process.exit(0);
    }

  } catch (error) {
    logger.error('Failed to start', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}

main();
