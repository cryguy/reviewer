import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../logger';
import { ToolError } from './errors';
import type { BotConfig } from '../config';

// ---------------------------------------------------------------------------
// cleanupRepo
// ---------------------------------------------------------------------------

export async function cleanupRepo(
  params: { repo_path: string },
  config: BotConfig,
): Promise<{ deleted: boolean }> {
  const { repo_path } = params;

  const cloneBasePath = config.cloneBasePath ?? path.join(os.tmpdir(), 'reviewer-cache');
  const resolvedBase = path.resolve(cloneBasePath);
  const resolvedRepoPath = path.resolve(repo_path);

  // Security: verify path starts with cloneBasePath
  if (!resolvedRepoPath.startsWith(resolvedBase)) {
    throw new ToolError(
      'PATH_NOT_FOUND',
      `repo_path is outside cloneBasePath: ${repo_path}`,
    );
  }

  try {
    await fs.rm(resolvedRepoPath, { recursive: true, force: true });
    logger.info('Repository cleaned up', { repo_path: resolvedRepoPath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ToolError('PATH_NOT_FOUND', `Failed to delete repo path: ${message}`);
  }

  return { deleted: true };
}
