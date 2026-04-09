import { parseRepoFromUrl } from '../github/client';
import { postComment as githubPostComment } from '../github/comments';
import { logger } from '../logger';
import { ToolError } from './errors';
import type { PostCommentResult } from '../github/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { PostCommentResult };

// ---------------------------------------------------------------------------
// postComment
// ---------------------------------------------------------------------------

export async function postComment(
  params: { pr_url: string; body: string },
  pat: string,
): Promise<PostCommentResult> {
  const { pr_url, body } = params;

  let owner: string;
  let repo: string;
  let number: number;

  try {
    ({ owner, repo, number } = parseRepoFromUrl(pr_url));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ToolError('PR_NOT_FOUND', message);
  }

  logger.info('Posting comment', { owner, repo, number });

  try {
    return await githubPostComment(pat, owner, repo, number, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('404')) {
      throw new ToolError('PR_NOT_FOUND', `PR not found: ${pr_url}`);
    }
    if (message.includes('403') || message.includes('429') || message.includes('rate limit')) {
      throw new ToolError('API_RATE_LIMITED', `GitHub API rate limited: ${message}`);
    }
    throw new ToolError('COMMENT_FAILED', message);
  }
}
