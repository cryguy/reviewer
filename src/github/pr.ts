import { logger } from '../logger';
import { githubRequest, githubRequestJson } from './client';
import type {
  PrDiff,
  PrComment,
  PrCommentType,
  PrMetadata,
  CiStatus,
  ChangedFiles,
} from './types';

// ---------------------------------------------------------------------------
// Internal response shapes
// ---------------------------------------------------------------------------

interface GhPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: { login: string };
  base: { ref: string; repo: { name: string; full_name: string; owner: { login: string } } };
  head: { ref: string; sha: string };
  labels: Array<{ name: string }>;
  requested_reviewers: Array<{ login: string }>;
  additions: number;
  deletions: number;
  changed_files: number;
  created_at: string;
  updated_at: string;
}

interface GhIssueComment {
  id: number;
  user: { login: string };
  body: string;
  created_at: string;
}

interface GhReviewComment {
  id: number;
  user: { login: string };
  body: string;
  created_at: string;
  path: string;
  line: number | null;
  original_line: number | null;
}

interface GhReview {
  id: number;
  user: { login: string };
  body: string;
  submitted_at: string;
  state: string;
}

interface GhCiStatus {
  state: string;
  statuses: Array<{ context: string; state: string; description: string | null }>;
}

interface GhFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

// ---------------------------------------------------------------------------
// getPrDiff
// ---------------------------------------------------------------------------

export async function getPrDiff(
  pat: string,
  owner: string,
  repo: string,
  number: number,
): Promise<PrDiff> {
  // Fetch diff text
  const diffResponse = await githubRequest(
    pat,
    'GET',
    `/repos/${owner}/${repo}/pulls/${number}`,
    { accept: 'application/vnd.github.v3.diff' },
  );

  if (!diffResponse.ok) {
    const text = await diffResponse.text();
    throw new Error(`Failed to fetch PR diff: ${diffResponse.status} ${text}`);
  }

  const diff = await diffResponse.text();

  // Fetch stats from JSON endpoint
  const pr = await githubRequestJson<GhPullRequest>(
    pat,
    'GET',
    `/repos/${owner}/${repo}/pulls/${number}`,
  );

  logger.debug('PR diff fetched', { owner, repo, number, diffLength: diff.length });

  return {
    diff,
    stats: {
      additions: pr.additions,
      deletions: pr.deletions,
      changed_files: pr.changed_files,
    },
  };
}

// ---------------------------------------------------------------------------
// getPrComments
// ---------------------------------------------------------------------------

export async function getPrComments(
  pat: string,
  owner: string,
  repo: string,
  number: number,
): Promise<PrComment[]> {
  const [issueComments, reviewComments, reviews] = await Promise.all([
    githubRequestJson<GhIssueComment[]>(
      pat,
      'GET',
      `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`,
    ),
    githubRequestJson<GhReviewComment[]>(
      pat,
      'GET',
      `/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`,
    ),
    githubRequestJson<GhReview[]>(
      pat,
      'GET',
      `/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`,
    ),
  ]);

  const mapped: PrComment[] = [];

  for (const c of issueComments) {
    mapped.push({
      id: c.id,
      author: c.user.login,
      body: c.body,
      created_at: c.created_at,
      type: 'issue_comment' as PrCommentType,
    });
  }

  for (const c of reviewComments) {
    mapped.push({
      id: c.id,
      author: c.user.login,
      body: c.body,
      created_at: c.created_at,
      type: 'review_comment' as PrCommentType,
      path: c.path,
      line: c.line ?? c.original_line ?? undefined,
    });
  }

  for (const r of reviews) {
    if (!r.body) continue; // skip reviews with no body
    mapped.push({
      id: r.id,
      author: r.user.login,
      body: r.body,
      created_at: r.submitted_at,
      type: 'review' as PrCommentType,
    });
  }

  mapped.sort((a, b) => a.created_at.localeCompare(b.created_at));

  logger.debug('PR comments fetched', {
    owner,
    repo,
    number,
    total: mapped.length,
  });

  return mapped;
}

// ---------------------------------------------------------------------------
// getPrMetadata
// ---------------------------------------------------------------------------

export async function getPrMetadata(
  pat: string,
  owner: string,
  repo: string,
  number: number,
): Promise<PrMetadata> {
  const pr = await githubRequestJson<GhPullRequest>(
    pat,
    'GET',
    `/repos/${owner}/${repo}/pulls/${number}`,
  );

  let ciStatus: CiStatus | null = null;
  try {
    const status = await githubRequestJson<GhCiStatus>(
      pat,
      'GET',
      `/repos/${owner}/${repo}/commits/${pr.head.sha}/status`,
    );
    ciStatus = {
      state: status.state,
      statuses: status.statuses.map((s) => ({
        context: s.context,
        state: s.state,
        description: s.description,
      })),
    };
  } catch (err) {
    logger.warn('Could not fetch CI status', { owner, repo, sha: pr.head.sha, error: String(err) });
  }

  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    author: pr.user.login,
    state: pr.state,
    base_branch: pr.base.ref,
    head_branch: pr.head.ref,
    head_sha: pr.head.sha,
    labels: pr.labels.map((l) => l.name),
    reviewers: pr.requested_reviewers.map((r) => r.login),
    ci_status: ciStatus,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    repo: {
      owner: pr.base.repo.owner.login,
      name: pr.base.repo.name,
      full_name: pr.base.repo.full_name,
    },
  };
}

// ---------------------------------------------------------------------------
// listChangedFiles
// ---------------------------------------------------------------------------

export async function listChangedFiles(
  pat: string,
  owner: string,
  repo: string,
  number: number,
): Promise<ChangedFiles> {
  const files = await githubRequestJson<GhFile[]>(
    pat,
    'GET',
    `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`,
  );

  logger.debug('Changed files fetched', { owner, repo, number, count: files.length });

  return {
    files: files.map((f) => ({
      path: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    })),
    total: files.length,
  };
}
