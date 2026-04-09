import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../logger';
import { ToolError } from './errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchMatch {
  file: string;
  line: number;
  content: string;
  context_before: string[];
  context_after: string[];
}

export interface SearchResult {
  matches: SearchMatch[];
  total_matches: number;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// searchCode
// ---------------------------------------------------------------------------

export async function searchCode(
  params: {
    repo_path: string;
    query: string;
    file_glob?: string;
    max_results?: number;
  },
): Promise<SearchResult> {
  const { repo_path, query, file_glob, max_results = 50 } = params;

  // Verify repo exists
  try {
    await fs.access(path.resolve(repo_path));
  } catch {
    throw new ToolError('REPO_NOT_FOUND', `Repository path not found: ${repo_path}`);
  }

  // Build git grep command
  // -F: fixed string (no regex), -n: line numbers, -B2 -A2: context lines
  const args = ['git', 'grep', '-F', '-n', '-B2', '-A2', query];

  if (file_glob) {
    args.push('--', file_glob);
  }

  logger.info('Searching code', { repo_path, query, file_glob, max_results });

  let stdout = '';
  try {
    const proc = Bun.spawn(args, {
      cwd: repo_path,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // 30-second timeout
    const timeoutHandle = setTimeout(() => {
      proc.kill();
    }, 30_000);

    const [exitCode, stdoutText, stderrText] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    clearTimeout(timeoutHandle);

    // Exit code 1 means no matches — not an error
    if (exitCode !== 0 && exitCode !== 1) {
      throw new ToolError(
        'INVALID_PATTERN',
        `git grep failed (exit ${exitCode}): ${stderrText}`,
      );
    }

    stdout = stdoutText;
  } catch (err) {
    if (err instanceof ToolError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ToolError('INVALID_PATTERN', `Search failed: ${message}`);
  }

  if (!stdout.trim()) {
    return { matches: [], total_matches: 0, truncated: false };
  }

  // Parse git grep output with context (-B/-A lines)
  // Format lines: "filename:linenum:content" for matches, "filename-linenum-content" for context,
  // "--" as group separator
  const matches: SearchMatch[] = [];
  const groups = stdout.split(/^--$/m);

  for (const group of groups) {
    const lines = group.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;

    let matchFile = '';
    let matchLine = 0;
    let matchContent = '';
    const contextBefore: string[] = [];
    const contextAfter: string[] = [];
    let matchFound = false;

    for (const line of lines) {
      // Match line: "filename:linenum:content"
      const matchResult = line.match(/^([^:]+):(\d+):(.*)$/);
      if (matchResult) {
        if (!matchFound) {
          matchFile = matchResult[1]!;
          matchLine = parseInt(matchResult[2]!, 10);
          matchContent = matchResult[3]!;
          matchFound = true;
        } else {
          contextAfter.push(matchResult[3]!);
        }
        continue;
      }

      // Context line: "filename-linenum-content"
      const contextResult = line.match(/^([^-]+)-(\d+)-(.*)$/);
      if (contextResult) {
        if (!matchFound) {
          contextBefore.push(contextResult[3]!);
        } else {
          contextAfter.push(contextResult[3]!);
        }
      }
    }

    if (matchFound) {
      matches.push({
        file: matchFile,
        line: matchLine,
        content: matchContent,
        context_before: contextBefore,
        context_after: contextAfter,
      });
    }
  }

  const totalMatches = matches.length;
  const truncated = totalMatches > max_results;
  const limited = matches.slice(0, max_results);

  logger.debug('Code search complete', { total_matches: totalMatches, truncated });

  return {
    matches: limited,
    total_matches: totalMatches,
    truncated,
  };
}
