import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../logger';
import { ToolError } from './errors';

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface FileContentsResult {
  content: string;
  size_bytes: number;
  encoding: 'utf-8';
}

// ---------------------------------------------------------------------------
// getFileContents
// ---------------------------------------------------------------------------

export async function getFileContents(
  params: { repo_path: string; file_path: string },
): Promise<FileContentsResult> {
  const { repo_path, file_path } = params;

  // Security: resolve and verify the file path stays within repo_path
  const resolvedPath = path.resolve(repo_path, file_path);
  const resolvedRepo = path.resolve(repo_path);

  if (!resolvedPath.startsWith(resolvedRepo)) {
    throw new ToolError('FILE_NOT_FOUND', `file_path escapes repo_path: ${file_path}`);
  }

  // Check repo exists
  try {
    await fs.access(resolvedRepo);
  } catch {
    throw new ToolError('REPO_NOT_FOUND', `Repository path not found: ${repo_path}`);
  }

  // Check file exists
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(resolvedPath);
  } catch {
    throw new ToolError('FILE_NOT_FOUND', `File not found: ${file_path}`);
  }

  const sizeBytes = stat.size;

  // Binary detection: read first 8KB and check for null bytes
  const SAMPLE_SIZE = 8192;
  let fileHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    fileHandle = await fs.open(resolvedPath, 'r');
    const buffer = Buffer.alloc(Math.min(SAMPLE_SIZE, sizeBytes));
    await fileHandle.read(buffer, 0, buffer.length, 0);

    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === 0) {
        throw new ToolError('BINARY_FILE', `File appears to be binary: ${file_path}`);
      }
    }
  } finally {
    await fileHandle?.close();
  }

  // Read full file as text
  const content = await fs.readFile(resolvedPath, 'utf-8');

  logger.debug('File contents read', { file_path, size_bytes: sizeBytes });

  return {
    content,
    size_bytes: sizeBytes,
    encoding: 'utf-8',
  };
}
