import { getDb } from '../db/index.ts';
import { enqueue } from '../db/queue.ts';
import { addReaction } from '../github/reactions.ts';
import { parseRepoFromUrl } from '../github/client.ts';
import { logger } from '../logger.ts';
import type { MentionNotification } from '../github/types.ts';
import type { Config } from '../config.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AppConfig = Config;

// ---------------------------------------------------------------------------
// Whitelist check
// ---------------------------------------------------------------------------

export function isWhitelisted(username: string, whitelist: string[]): boolean {
  const lower = username.toLowerCase();
  return whitelist.some((w) => w.toLowerCase() === lower);
}

// ---------------------------------------------------------------------------
// Dedup check
// ---------------------------------------------------------------------------

export function isAlreadyProcessed(commentId: number): boolean {
  const db = getDb();
  const row = db
    .query<{ id: string }, [number]>(
      `SELECT id FROM runs WHERE trigger_comment_id = ? LIMIT 1`,
    )
    .get(commentId);
  return row !== null;
}

// ---------------------------------------------------------------------------
// Process a single mention
// ---------------------------------------------------------------------------

export async function processMention(
  mention: MentionNotification,
  config: AppConfig,
): Promise<void> {
  const { prUrl, commentId, commentBody, commentAuthor } = mention;

  // 1. Check whitelist
  if (config.whitelist.length > 0 && !isWhitelisted(commentAuthor, config.whitelist)) {
    logger.info('Mention from non-whitelisted user, skipping', {
      author: commentAuthor,
      commentId,
    });
    return;
  }

  // 2. Check dedup
  if (isAlreadyProcessed(commentId)) {
    logger.debug('Comment already processed, skipping', { commentId });
    return;
  }

  // 3. Add eyes reaction to signal we're looking
  const { owner, repo, number } = parseRepoFromUrl(prUrl);
  const pat = config.bot.githubPAT;

  try {
    await addReaction(pat, owner, repo, commentId, 'eyes');
  } catch (err) {
    logger.warn('Failed to add eyes reaction', {
      commentId,
      error: String(err),
    });
  }

  // 4. Create a queued run
  const run = enqueue({
    pr_url: prUrl,
    pr_number: number,
    repo: `${owner}/${repo}`,
    trigger_comment_id: commentId,
    trigger_user: commentAuthor,
    trigger_body: commentBody,
    timeout_minutes: config.bot.runTimeoutMinutes,
  });

  logger.info('Mention enqueued', {
    runId: run.id,
    commentId,
    author: commentAuthor,
    prUrl,
  });
}
