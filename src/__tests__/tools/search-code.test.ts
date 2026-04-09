import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { searchCode } from '../../tools/search-code.ts';
import { ToolError } from '../../tools/errors.ts';

// ---------------------------------------------------------------------------
// Setup a temp git repo for search tests
// ---------------------------------------------------------------------------

let repoDir: string;

beforeAll(async () => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-search-test-'));

  // Write some source files
  fs.writeFileSync(
    path.join(repoDir, 'index.ts'),
    `export function greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n`,
    'utf-8',
  );
  fs.writeFileSync(
    path.join(repoDir, 'utils.ts'),
    `export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport const SECRET_KEY = 'abc123';\n`,
    'utf-8',
  );
  fs.writeFileSync(
    path.join(repoDir, 'README.md'),
    `# Test repo\n\nThis is a test repository for search-code tests.\n`,
    'utf-8',
  );

  // Initialize git repo so git grep works
  const init = Bun.spawn(['git', 'init'], { cwd: repoDir, stdout: 'pipe', stderr: 'pipe' });
  await init.exited;

  const add = Bun.spawn(['git', 'add', '.'], { cwd: repoDir, stdout: 'pipe', stderr: 'pipe' });
  await add.exited;

  const commit = Bun.spawn(
    ['git', '-c', 'user.email=test@test.com', '-c', 'user.name=Test', 'commit', '-m', 'init'],
    { cwd: repoDir, stdout: 'pipe', stderr: 'pipe' },
  );
  await commit.exited;
});

afterAll(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searchCode', () => {
  it('finds a pattern in the repo', async () => {
    const result = await searchCode({ repo_path: repoDir, query: 'SECRET_KEY' });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.total_matches).toBeGreaterThan(0);
    const match = result.matches[0]!;
    expect(match.file).toContain('utils.ts');
    expect(match.content).toContain('SECRET_KEY');
  });

  it('returns empty results for non-matching pattern', async () => {
    const result = await searchCode({ repo_path: repoDir, query: 'THIS_PATTERN_DOES_NOT_EXIST_XYZ' });
    expect(result.matches).toHaveLength(0);
    expect(result.total_matches).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('respects max_results limit and sets truncated flag', async () => {
    // 'export' appears in multiple files — use max_results=1
    const result = await searchCode({ repo_path: repoDir, query: 'export', max_results: 1 });
    expect(result.matches.length).toBeLessThanOrEqual(1);
    if (result.total_matches > 1) {
      expect(result.truncated).toBe(true);
    }
  });

  it('returns line number for each match', async () => {
    const result = await searchCode({ repo_path: repoDir, query: 'SECRET_KEY' });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]!.line).toBeGreaterThan(0);
  });

  it('throws REPO_NOT_FOUND for non-existent repo path', async () => {
    let caught: unknown;
    try {
      await searchCode({
        repo_path: path.join(os.tmpdir(), 'nonexistent-repo-xyz-999'),
        query: 'anything',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ToolError);
    expect((caught as ToolError).code).toBe('REPO_NOT_FOUND');
  });

  it('filters by file_glob', async () => {
    const result = await searchCode({
      repo_path: repoDir,
      query: 'export',
      file_glob: '*.ts',
    });
    // All matches should be in .ts files
    for (const match of result.matches) {
      expect(match.file).toMatch(/\.ts$/);
    }
  });
});
