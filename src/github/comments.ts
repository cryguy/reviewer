import { logger } from '../logger';
import { githubRequestJson } from './client';
import type { PostCommentResult, PostReviewResult, InlineCommentInput } from './types';

// ---------------------------------------------------------------------------
// Internal response shapes
// ---------------------------------------------------------------------------

interface GhCommentResponse {
  id: number;
  html_url: string;
}

// ---------------------------------------------------------------------------
// postComment
// ---------------------------------------------------------------------------

export async function postComment(
  pat: string,
  owner: string,
  repo: string,
  number: number,
  body: string,
): Promise<PostCommentResult> {
  const response = await githubRequestJson<GhCommentResponse>(
    pat,
    'POST',
    `/repos/${owner}/${repo}/issues/${number}/comments`,
    { body: { body } },
  );

  logger.info('Comment posted', { owner, repo, number, commentId: response.id });

  return {
    comment_id: response.id,
    comment_url: response.html_url,
  };
}

// ---------------------------------------------------------------------------
// postReview
// ---------------------------------------------------------------------------

export async function postReview(
  pat: string,
  owner: string,
  repo: string,
  number: number,
  summary: string,
  inlineComments?: InlineCommentInput[],
): Promise<PostReviewResult> {
  // Step 1: Post summary as an issue comment
  const commentResult = await postComment(pat, owner, repo, number, summary);

  let inlinePosted = 0;

  // Step 2: Post inline review comments if provided
  if (inlineComments && inlineComments.length > 0) {
    await githubRequestJson(
      pat,
      'POST',
      `/repos/${owner}/${repo}/pulls/${number}/reviews`,
      {
        body: {
          event: 'COMMENT',
          body: '',
          comments: inlineComments.map((c) => ({
            path: c.path,
            line: c.line,
            body: c.body,
            side: c.side ?? 'RIGHT',
          })),
        },
      },
    );
    inlinePosted = inlineComments.length;
    logger.info('Inline review comments posted', { owner, repo, number, count: inlinePosted });
  }

  return {
    comment_id: commentResult.comment_id,
    comment_url: commentResult.comment_url,
    inline_comments_posted: inlinePosted,
  };
}
