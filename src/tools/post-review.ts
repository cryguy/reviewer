import { parseRepoFromUrl } from '../github/client';
import { postReview as githubPostReview } from '../github/comments';
import { logger } from '../logger';
import { ToolError } from './errors';
import type { PostReviewResult, InlineCommentInput } from '../github/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InlineComment = InlineCommentInput;
export type { PostReviewResult };

// ---------------------------------------------------------------------------
// postReview
// ---------------------------------------------------------------------------

export async function postReview(
  params: {
    pr_url: string;
    summary: string;
    inline_comments?: InlineComment[];
  },
  pat: string,
): Promise<PostReviewResult> {
  const { pr_url, summary, inline_comments } = params;

  let owner: string;
  let repo: string;
  let number: number;

  try {
    ({ owner, repo, number } = parseRepoFromUrl(pr_url));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ToolError('PR_NOT_FOUND', message);
  }

  logger.info('Posting review', { owner, repo, number, hasInlineComments: !!inline_comments?.length });

  try {
    return await githubPostReview(pat, owner, repo, number, summary, inline_comments);
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
