import { getDb } from '../db/index.ts';
import { pollNotifications } from '../github/notifications.ts';
import { markNotificationRead } from '../github/notifications.ts';
import { processMention } from './trigger.ts';
import { logger } from '../logger.ts';
import type { Config } from '../config.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NamedBinding = Record<string, string | number | boolean | null>;

// ---------------------------------------------------------------------------
// KV helpers
// ---------------------------------------------------------------------------

function getKv(key: string): string | null {
  const db = getDb();
  const row = db
    .query<{ value: string }, [NamedBinding]>(
      `SELECT value FROM kv WHERE key = $key`,
    )
    .get({ $key: key });
  return row?.value ?? null;
}

function setKv(key: string, value: string): void {
  const db = getDb();
  db.query<unknown, [NamedBinding]>(
    `INSERT INTO kv (key, value) VALUES ($key, $value)
     ON CONFLICT(key) DO UPDATE SET value = $value`,
  ).run({ $key: key, $value: value });
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _interval: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Poller
// ---------------------------------------------------------------------------

export function startPoller(config: Config): void {
  if (_interval !== null) {
    logger.warn('Poller already running');
    return;
  }

  const intervalMs = config.bot.pollIntervalSeconds * 1000;
  logger.info('Starting notification poller', { intervalMs });

  // Run immediately on startup, then on interval
  pollTick(config);

  _interval = setInterval(() => {
    pollTick(config);
  }, intervalMs);
}

export function stopPoller(): void {
  if (_interval !== null) {
    clearInterval(_interval);
    _interval = null;
    logger.info('Poller stopped');
  }
}

// ---------------------------------------------------------------------------
// Single poll tick
// ---------------------------------------------------------------------------

async function pollTick(config: Config): Promise<void> {
  try {
    // Read last poll timestamp from kv table (default to 1 hour ago).
    // Subtract a 5-minute overlap buffer to catch notifications that were
    // slow to propagate through GitHub's API.
    let lastPoll = getKv('lastPollTimestamp');
    if (lastPoll === null) {
      lastPoll = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    } else {
      lastPoll = new Date(new Date(lastPoll).getTime() - 5 * 60 * 1000).toISOString();
    }

    // Poll GitHub notifications
    const mentions = await pollNotifications(config.bot.githubPAT, lastPoll);

    // Process each mention
    for (const mention of mentions) {
      try {
        await processMention(mention, config);

        // Mark notification as read
        await markNotificationRead(config.bot.githubPAT, mention.notificationId);
      } catch (err) {
        logger.error('Failed to process mention', {
          commentId: mention.commentId,
          prUrl: mention.prUrl,
          error: String(err),
        });
      }
    }

    // Update last poll timestamp
    setKv('lastPollTimestamp', new Date().toISOString());
  } catch (err) {
    logger.error('Poll tick error', { error: String(err) });
  }
}
