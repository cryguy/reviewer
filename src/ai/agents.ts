import { createClaudeCode } from 'ai-sdk-provider-claude-code';
import { createCodexAppServer, type Session } from 'ai-sdk-provider-codex-app-server';
import type { ClaudeAgentConfig, CodexAgentConfig } from '../config.ts';
import { resolveCodexPath } from './providers.ts';

// Create a Claude Code agent scoped to a repo path
export function createClaudeAgent(repoPath: string, config: ClaudeAgentConfig) {
  const provider = createClaudeCode({
    defaultSettings: {
      cwd: repoPath,
      allowedTools: config.allowedTools,
      permissionMode: config.permissionMode as any,
    },
  });
  return provider(config.model);
}

// Create a Codex agent scoped to a repo path
export function createCodexAgent(repoPath: string, config: CodexAgentConfig) {
  let session: Session | undefined;
  const provider = createCodexAppServer({
    defaultSettings: {
      codexPath: resolveCodexPath(),
      cwd: repoPath,
      sandboxMode: config.sandboxMode,
      reasoningEffort: config.reasoningEffort,
      approvalMode: 'never',
      onSessionCreated: (s: Session) => {
        session = s;
      },
    },
  });
  return { model: provider(config.model), getSession: () => session };
}
