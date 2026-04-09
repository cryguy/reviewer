import { logger } from '../logger';
import { githubRequest } from './client';
import type { ReactionContent } from './types';

export async function addReaction(
  pat: string,
  owner: string,
  repo: string,
  commentId: number,
  reaction: ReactionContent,
): Promise<void> {
  const response = await githubRequest(
    pat,
    'POST',
    `/repos/${owner}/${repo}/issues/comments/${commentId}/reactions`,
    { body: { content: reaction } },
  );

  if (response.status === 422) {
    // Reaction already exists — not an error
    logger.debug('Reaction already exists', { owner, repo, commentId, reaction });
    return;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to add reaction "${reaction}" to comment ${commentId}: ${response.status} ${text}`,
    );
  }

  logger.debug('Reaction added', { owner, repo, commentId, reaction });
}
