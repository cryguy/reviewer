import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseRepoFromUrl } from '../github/client';
import { getPrMetadata } from '../github/pr';
import { logger } from '../logger';
import { ToolError } from './errors';
import type { BotConfig } from '../config';

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface CloneResult {
  repo_path: string;
  branch: string;
  base_branch: string;
  clone_duration_ms: number;
}

// ---------------------------------------------------------------------------
// cloneRepo
// ---------------------------------------------------------------------------

export async function cloneRepo(
  params: { pr_url: string },
  runId: string,
  config: BotConfig,
): Promise<CloneResult> {
  const { pr_url } = params;

  // Security: validate URL format
  const urlPattern = /^https:\/\/github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+/;
  if (!urlPattern.test(pr_url)) {
    throw new ToolError('CLONE_FAILED', `Invalid GitHub PR URL: ${pr_url}`);
  }

  const { owner, repo, number } = parseRepoFromUrl(pr_url);

  // Security: validate PR number is numeric (parseRepoFromUrl already ensures this via parseInt)
  if (!Number.isInteger(number) || number <= 0) {
    throw new ToolError('CLONE_FAILED', `Invalid PR number: ${number}`);
  }

  const cloneBasePath = config.cloneBasePath ?? path.join(os.tmpdir(), 'reviewer-cache');
  const clonePath = path.join(cloneBasePath, runId);

  // Security: validate output path is under cloneBasePath
  const resolvedClonePath = path.resolve(clonePath);
  const resolvedBase = path.resolve(cloneBasePath);
  if (!resolvedClonePath.startsWith(resolvedBase)) {
    throw new ToolError('CLONE_FAILED', `Clone path escapes base directory: ${clonePath}`);
  }

  // Idempotency: if path already exists, return without re-cloning
  if (fs.existsSync(clonePath)) {
    logger.info('Clone path already exists, skipping clone', { clonePath, runId });

    // Fetch metadata to get branch info
    const pat = config.githubPAT;
    const metadata = await getPrMetadata(pat, owner, repo, number);

    return {
      repo_path: clonePath,
      branch: metadata.head_branch,
      base_branch: metadata.base_branch,
      clone_duration_ms: 0,
    };
  }

  // Fetch PR metadata to get head branch
  const pat = config.githubPAT;
  const metadata = await getPrMetadata(pat, owner, repo, number);
  const headBranch = metadata.head_branch;
  const baseBranch = metadata.base_branch;
  const repoUrl = `https://github.com/${owner}/${repo}.git`;

  logger.info('Cloning repository', { owner, repo, headBranch, clonePath });

  const startMs = Date.now();

  const proc = Bun.spawn(
    ['git', 'clone', '--depth=1', '--branch', headBranch, repoUrl, clonePath],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new ToolError('CLONE_FAILED', `git clone failed (exit ${exitCode}): ${stderr}`);
  }

  const cloneDurationMs = Date.now() - startMs;

  logger.info('Repository cloned', { clonePath, cloneDurationMs });

  return {
    repo_path: clonePath,
    branch: headBranch,
    base_branch: baseBranch,
    clone_duration_ms: cloneDurationMs,
  };
}
