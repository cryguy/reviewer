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


// ---------------------------------------------------------------------------
// Whitelist check
// ---------------------------------------------------------------------------

export function isWhitelisted(username: string, whitelist: string[]): boolean {
  const lower = username.toLowerCase();
  return whitelist.some((w) => w.toLowerCase() === lower);
}

// ---------------------------------------------------------------------------
// Explicit-mention check
// ---------------------------------------------------------------------------

// GitHub's notification reason "mention" fires for edits, quoted text, and
// subscribed-thread activity — not only fresh @mentions. This check requires
// the bot's handle to appear as a real @mention token in the unquoted body.
export function mentionsBotDirectly(body: string, botUsername: string): boolean {
  // Drop markdown blockquote lines so quoted prior mentions don't re-trigger.
  const unquoted = body
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n');

  const escaped = botUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Standalone token: not preceded or followed by a word char or hyphen.
  const re = new RegExp(`(?:^|[^\\w-])@${escaped}(?=$|[^\\w-])`, 'i');
  return re.test(unquoted);
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
  config: Config,
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

  // 2. Require explicit @bot mention in the comment body. GitHub's notification
  //    "mention" reason also fires for edits, quoted blocks, and subscribed
  //    threads — this prevents those spurious triggers.
  if (!mentionsBotDirectly(commentBody, config.bot.githubUsername)) {
    logger.info('Notification flagged as mention but body does not directly @mention bot, skipping', {
      commentId,
      author: commentAuthor,
      botUsername: config.bot.githubUsername,
    });
    return;
  }

  // 3. Check dedup
  if (isAlreadyProcessed(commentId)) {
    logger.debug('Comment already processed, skipping', { commentId });
    return;
  }

  // 4. Add eyes reaction to signal we're looking
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

  // 5. Create a queued run (or merge into existing queued run for same PR)
  const { run, merged } = enqueue({
    pr_url: prUrl,
    pr_number: number,
    repo: `${owner}/${repo}`,
    trigger_comment_id: commentId,
    trigger_user: commentAuthor,
    trigger_body: commentBody,
    timeout_minutes: config.bot.runTimeoutMinutes,
  });

  if (merged) {
    // Acknowledge the merged comment with a rocket reaction
    try {
      await addReaction(pat, owner, repo, commentId, 'rocket');
    } catch {
      // Ignore reaction failure
    }
  }

  logger.info(merged ? 'Mention merged into queued run' : 'Mention enqueued', {
    runId: run.id,
    commentId,
    author: commentAuthor,
    prUrl,
    merged,
  });
}
