import { parseRepoFromUrl } from '../github/client';
import { getPrDiff as githubGetPrDiff } from '../github/pr';
import { logger } from '../logger';
import { ToolError } from './errors';
import type { PrDiff } from '../github/types';

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export type PrDiffResult = PrDiff;

// ---------------------------------------------------------------------------
// getPrDiff
// ---------------------------------------------------------------------------

export async function getPrDiff(
  params: { pr_url: string },
  pat: string,
): Promise<PrDiffResult> {
  const { pr_url } = params;

  let owner: string;
  let repo: string;
  let number: number;

  try {
    ({ owner, repo, number } = parseRepoFromUrl(pr_url));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ToolError('PR_NOT_FOUND', message);
  }

  logger.info('Fetching PR diff', { owner, repo, number });

  try {
    return await githubGetPrDiff(pat, owner, repo, number);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('404')) {
      throw new ToolError('PR_NOT_FOUND', `PR not found: ${pr_url}`);
    }
    if (message.includes('403') || message.includes('429') || message.includes('rate limit')) {
      throw new ToolError('API_RATE_LIMITED', `GitHub API rate limited: ${message}`);
    }
    throw new ToolError('PR_NOT_FOUND', message);
  }
}
