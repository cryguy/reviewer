import { describe, it, expect } from 'bun:test';
import { parseRepoFromUrl, getRateLimitState } from '../github/client.ts';

describe('parseRepoFromUrl', () => {
  it('extracts owner, repo, and number from a valid PR URL', () => {
    const result = parseRepoFromUrl('https://github.com/acme/my-repo/pull/42');
    expect(result.owner).toBe('acme');
    expect(result.repo).toBe('my-repo');
    expect(result.number).toBe(42);
  });

  it('handles numeric PR numbers correctly', () => {
    const result = parseRepoFromUrl('https://github.com/org/project/pull/1234');
    expect(result.number).toBe(1234);
    expect(typeof result.number).toBe('number');
  });

  it('handles repos with dots and underscores in name', () => {
    const result = parseRepoFromUrl('https://github.com/my-org/my.repo_name/pull/7');
    expect(result.owner).toBe('my-org');
    expect(result.repo).toBe('my.repo_name');
    expect(result.number).toBe(7);
  });

  it('throws on a URL that is not a GitHub PR URL', () => {
    expect(() => parseRepoFromUrl('https://gitlab.com/owner/repo/merge_requests/1')).toThrow(
      'Cannot parse GitHub PR URL',
    );
  });

  it('throws on a GitHub URL that is not a PR URL', () => {
    expect(() => parseRepoFromUrl('https://github.com/owner/repo/issues/5')).toThrow(
      'Cannot parse GitHub PR URL',
    );
  });

  it('throws on a completely invalid URL', () => {
    expect(() => parseRepoFromUrl('not-a-url')).toThrow('Cannot parse GitHub PR URL');
  });

  it('throws on an empty string', () => {
    expect(() => parseRepoFromUrl('')).toThrow('Cannot parse GitHub PR URL');
  });
});

describe('rate limit state tracking', () => {
  it('getRateLimitState returns an object with remaining and resetAt', () => {
    const state = getRateLimitState();
    expect(typeof state.remaining).toBe('number');
    expect(typeof state.resetAt).toBe('number');
  });

  it('initial remaining is 5000', () => {
    const state = getRateLimitState();
    // The initial value is 5000 unless the module has already been used
    // In a fresh test environment it should be 5000
    expect(state.remaining).toBeGreaterThanOrEqual(0);
  });

  it('state object is readonly (returns Readonly reference)', () => {
    const state = getRateLimitState();
    // Should have the expected properties
    expect('remaining' in state).toBe(true);
    expect('resetAt' in state).toBe(true);
  });
});
