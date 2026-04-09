import { logger } from '../logger';
import { githubRequest, githubRequestJson } from './client';
import type { MentionNotification } from './types';

// ---------------------------------------------------------------------------
// GitHub API response shapes (internal)
// ---------------------------------------------------------------------------

interface GhNotificationSubject {
  title: string;
  url: string;
  latest_comment_url: string | null;
  type: string;
}

interface GhNotification {
  id: string;
  reason: string;
  subject: GhNotificationSubject;
}

interface GhComment {
  id: number;
  body: string;
  user: { login: string };
  html_url: string;
}

interface GhPullRequest {
  html_url: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPrUrlFromSubject(subject: GhNotificationSubject): string | null {
  // subject.url is like https://api.github.com/repos/org/repo/pulls/123
  const match = subject.url.match(/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)/);
  if (!match) return null;
  return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function pollNotifications(
  pat: string,
  since: string,
): Promise<MentionNotification[]> {
  const notifications = await githubRequestJson<GhNotification[]>(
    pat,
    'GET',
    `/notifications?participating=true&since=${encodeURIComponent(since)}`,
  );

  const mentions = notifications.filter(
    (n) => n.reason === 'mention' && n.subject.type === 'PullRequest',
  );

  logger.info('Notifications polled', {
    total: notifications.length,
    mentions: mentions.length,
  });

  const results: MentionNotification[] = [];

  for (const notification of mentions) {
    const prUrl = extractPrUrlFromSubject(notification.subject);
    if (!prUrl) {
      logger.warn('Could not extract PR URL from notification', { id: notification.id });
      continue;
    }

    const commentUrl = notification.subject.latest_comment_url;
    if (!commentUrl) {
      logger.warn('Notification has no latest_comment_url', { id: notification.id });
      continue;
    }

    try {
      const comment = await githubRequestJson<GhComment>(pat, 'GET', commentUrl);

      results.push({
        prUrl,
        commentId: comment.id,
        commentBody: comment.body,
        commentAuthor: comment.user.login,
        notificationId: notification.id,
      });
    } catch (err) {
      logger.error('Failed to fetch comment for notification', {
        notificationId: notification.id,
        commentUrl,
        error: String(err),
      });
    }
  }

  return results;
}

export async function markNotificationRead(pat: string, notificationId: string): Promise<void> {
  const response = await githubRequest(pat, 'PATCH', `/notifications/threads/${notificationId}`);

  if (!response.ok && response.status !== 205) {
    const text = await response.text();
    throw new Error(
      `Failed to mark notification ${notificationId} as read: ${response.status} ${text}`,
    );
  }

  logger.debug('Notification marked as read', { notificationId });
}
