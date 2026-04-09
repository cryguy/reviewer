import { loadConfig } from './config';
import { logger } from './logger';
import { getDb } from './db';
import { recoverInterruptedRuns } from './db/queue';
import { checkRateLimit } from './github/client';
import { startPoller, stopPoller } from './polling/poller';
import { startQueueProcessor, stopQueueProcessor } from './queue/manager';
import { startServer, stopServer } from './server';

async function main() {
  try {
    // 1. Load and validate config
    const config = loadConfig();
    logger.info('Configuration loaded successfully');

    // 2. Initialize SQLite database (creates tables if needed)
    const db = getDb();
    logger.info('Database initialized');

    // 3. Recovery: find RUNNING jobs → reset to QUEUED
    const recovered = recoverInterruptedRuns();
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
