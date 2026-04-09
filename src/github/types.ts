// ---------------------------------------------------------------------------
// Shared GitHub API types
// ---------------------------------------------------------------------------

export interface RepoRef {
  owner: string;
  repo: string;
  number: number;
}

export interface RateLimitState {
  remaining: number;
  resetAt: number; // Unix timestamp seconds
}

// Notifications

export interface MentionNotification {
  prUrl: string;
  commentId: number;
  commentBody: string;
  commentAuthor: string;
  notificationId: string;
}

// PR diff

export interface PrDiffStats {
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface PrDiff {
  diff: string;
  stats: PrDiffStats;
}

// PR comments

export type PrCommentType = 'issue_comment' | 'review_comment' | 'review';

export interface PrComment {
  id: number;
  author: string;
  body: string;
  created_at: string;
  type: PrCommentType;
  path?: string;
  line?: number;
}

// PR metadata

export interface CiStatus {
  state: string;
  statuses: Array<{ context: string; state: string; description: string | null }>;
}

export interface PrRepo {
  owner: string;
  name: string;
  full_name: string;
}

export interface PrMetadata {
  number: number;
  title: string;
  body: string | null;
  author: string;
  state: string;
  base_branch: string;
  head_branch: string;
  head_sha: string;
  labels: string[];
  reviewers: string[];
  ci_status: CiStatus | null;
  created_at: string;
  updated_at: string;
  repo: PrRepo;
}

// Changed files

export interface ChangedFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface ChangedFiles {
  files: ChangedFile[];
  total: number;
}

// Reactions

export type ReactionContent = 'eyes' | 'rocket' | '+1' | 'heart';

// Comments / reviews

export interface PostCommentResult {
  comment_id: number;
  comment_url: string;
}

export interface InlineCommentInput {
  path: string;
  line: number;
  body: string;
  side?: 'LEFT' | 'RIGHT';
}

export interface PostReviewResult {
  comment_id: number;
  comment_url: string;
  inline_comments_posted: number;
}
