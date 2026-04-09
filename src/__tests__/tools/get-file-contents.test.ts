import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getFileContents } from '../../tools/get-file-contents.ts';
import { ToolError } from '../../tools/errors.ts';

// ---------------------------------------------------------------------------
// Setup temp directory
// ---------------------------------------------------------------------------

let tempDir: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-get-file-test-'));

  // Create a normal text file
  fs.writeFileSync(path.join(tempDir, 'hello.txt'), 'Hello, world!\nLine 2\n', 'utf-8');

  // Create a binary file (contains null bytes)
  const binaryBuf = Buffer.alloc(16);
  binaryBuf[0] = 0xff;
  binaryBuf[1] = 0xfe;
  binaryBuf[4] = 0x00; // null byte — triggers binary detection
  binaryBuf[8] = 0x42;
  fs.writeFileSync(path.join(tempDir, 'image.bin'), binaryBuf);

  // Create a subdirectory with a file
  fs.mkdirSync(path.join(tempDir, 'subdir'));
  fs.writeFileSync(path.join(tempDir, 'subdir', 'nested.ts'), 'export const x = 1;\n', 'utf-8');
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getFileContents', () => {
  it('reads a real text file successfully', async () => {
    const result = await getFileContents({
      repo_path: tempDir,
      file_path: 'hello.txt',
    });
    expect(result.content).toContain('Hello, world!');
    expect(result.encoding).toBe('utf-8');
    expect(result.size_bytes).toBeGreaterThan(0);
  });

  it('reads a nested file via relative path', async () => {
    const result = await getFileContents({
      repo_path: tempDir,
      file_path: 'subdir/nested.ts',
    });
    expect(result.content).toContain('export const x = 1;');
  });

  it('returns correct size_bytes', async () => {
    const content = 'Hello, world!\nLine 2\n';
    const result = await getFileContents({
      repo_path: tempDir,
      file_path: 'hello.txt',
    });
    expect(result.size_bytes).toBe(Buffer.byteLength(content, 'utf-8'));
  });

  it('throws FILE_NOT_FOUND for missing files', async () => {
    let caught: unknown;
    try {
      await getFileContents({ repo_path: tempDir, file_path: 'does-not-exist.txt' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ToolError);
    expect((caught as ToolError).code).toBe('FILE_NOT_FOUND');
  });

  it('detects path traversal attempts and throws FILE_NOT_FOUND', async () => {
    let caught: unknown;
    try {
      await getFileContents({ repo_path: tempDir, file_path: '../../etc/passwd' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ToolError);
    expect((caught as ToolError).code).toBe('FILE_NOT_FOUND');
    expect((caught as ToolError).message).toContain('escapes repo_path');
  });

  it('returns BINARY_FILE error for files with null bytes', async () => {
    let caught: unknown;
    try {
      await getFileContents({ repo_path: tempDir, file_path: 'image.bin' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ToolError);
    expect((caught as ToolError).code).toBe('BINARY_FILE');
    expect((caught as ToolError).message).toContain('binary');
  });

  it('throws REPO_NOT_FOUND when repo_path does not exist', async () => {
    let caught: unknown;
    try {
      await getFileContents({
        repo_path: path.join(os.tmpdir(), 'totally-nonexistent-repo-xyz-123'),
        file_path: 'hello.txt',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ToolError);
    expect((caught as ToolError).code).toBe('REPO_NOT_FOUND');
  });
});
