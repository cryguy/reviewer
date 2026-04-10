import {
  openaiCodexOAuthProvider,
  type OAuthCredentials,
} from '@mariozechner/pi-ai/oauth';
import { logger } from '../logger.ts';
import * as fs from 'fs';
import * as path from 'path';

export type { OAuthCredentials };

// Refresh 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const CREDENTIALS_PATH = path.join(process.cwd(), 'codex.json');

// ---------------------------------------------------------------------------
// Credential persistence (codex.json file)
// ---------------------------------------------------------------------------

function storeCredentials(creds: OAuthCredentials): void {
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), 'utf-8');
}

function loadCredentials(): OAuthCredentials | null {
  try {
    const text = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    const parsed = JSON.parse(text);

    // Migrate from old CodexCredentials format (SQLite era) if needed
    if (parsed.accessToken && !parsed.access) {
      return {
        access: parsed.accessToken,
        refresh: parsed.refreshToken,
        expires: parsed.expiresAt,
      };
    }

    return parsed as OAuthCredentials;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// OAuth login flow (delegates to pi-ai)
// ---------------------------------------------------------------------------

async function runLogin(): Promise<OAuthCredentials> {
  const creds = await openaiCodexOAuthProvider.login({
    onAuth: (info) => {
      console.log('\n========================================');
      console.log('  Codex OAuth Login Required');
      console.log('========================================');
      console.log('\nOpen this URL in your browser:\n');
      console.log(info.url);
      if (info.instructions) {
        console.log('\n' + info.instructions);
      }
      console.log('\nWaiting for authentication...\n');
    },
    onPrompt: async (prompt) => {
      console.log(prompt.message);
      return '';
    },
    onProgress: (message) => {
      logger.info('Codex OAuth progress', { message });
    },
  });

  storeCredentials(creds);
  logger.info('Codex OAuth credentials stored to codex.json');
  return creds;
}

// ---------------------------------------------------------------------------
// Get valid credentials (auto-refresh if expired, login if missing)
// ---------------------------------------------------------------------------

let _cachedCredentials: OAuthCredentials | null = null;

export async function getCodexCredentials(): Promise<OAuthCredentials> {
  // Check in-memory cache first
  if (_cachedCredentials && _cachedCredentials.expires > Date.now() + REFRESH_BUFFER_MS) {
    return _cachedCredentials;
  }

  // Try loading from file
  let creds = loadCredentials();

  if (creds) {
    // Check if token needs refresh
    if (creds.expires <= Date.now() + REFRESH_BUFFER_MS) {
      logger.info('Codex OAuth token expired, refreshing...');
      try {
        creds = await openaiCodexOAuthProvider.refreshToken(creds);
        storeCredentials(creds);
        logger.info('Codex OAuth token refreshed');
      } catch (err) {
        logger.warn('Token refresh failed, re-login required', { error: String(err) });
        creds = await runLogin();
      }
    }
  } else {
    creds = await runLogin();
  }

  _cachedCredentials = creds;
  return creds;
}

/** Extract the API key (access token) from credentials. */
export function getCodexApiKey(creds: OAuthCredentials): string {
  return openaiCodexOAuthProvider.getApiKey(creds);
}
