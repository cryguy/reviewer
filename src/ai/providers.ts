import { getModel, type Model } from '@mariozechner/pi-ai';
import { openaiCodexOAuthProvider, type OAuthCredentials } from '@mariozechner/pi-ai/oauth';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

// ---------------------------------------------------------------------------
// Codex CLI path resolution (for spawn_codex_cli agent tool)
// ---------------------------------------------------------------------------

export function resolveCodexPath(): string {
  if (process.platform !== 'win32') return 'codex';

  try {
    const wherePaths = execSync('where codex', { encoding: 'utf8' })
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const cmdPath = wherePaths.find((l) => l.endsWith('.cmd'));
    if (cmdPath && existsSync(cmdPath)) return cmdPath;
  } catch {
    // Fall through
  }
  return 'codex';
}

// ---------------------------------------------------------------------------
// Orchestrator: nano-gpt (OpenAI-compatible custom endpoint)
// ---------------------------------------------------------------------------

export function createNanogptModel(apiKey: string, modelId: string): Model<'openai-completions'> {
  void apiKey; // key is passed at call time via getApiKey
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: 'nanogpt',
    baseUrl: 'https://nano-gpt.com/api/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 32_000,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
      maxTokensField: 'max_tokens',
    },
  };
}

// ---------------------------------------------------------------------------
// Orchestrator: Codex Responses API (via pi-ai openai-codex-responses)
// Uses OAuth tokens + chatgpt.com/backend-api/codex endpoint
// ---------------------------------------------------------------------------

export function createCodexResponsesModel(credentials: OAuthCredentials, modelId: string): Model<'openai-codex-responses'> {
  const baseModel: Model<'openai-codex-responses'> = {
    id: modelId,
    name: modelId,
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256_000,
    maxTokens: 32_000,
  };

  // Let pi-ai's OAuth provider inject auth headers (chatgpt-account-id, etc.)
  if (openaiCodexOAuthProvider.modifyModels) {
    return openaiCodexOAuthProvider.modifyModels([baseModel], credentials)[0] as Model<'openai-codex-responses'>;
  }
  return baseModel;
}

// ---------------------------------------------------------------------------
// Standard pi-ai providers (openai, anthropic, google, etc.)
// Uses built-in model registry — API keys resolved from environment variables.
// ---------------------------------------------------------------------------

export function createStandardModel(provider: string, modelId: string): Model<string> {
  // getModel has per-provider overloads; at runtime any registered provider/model works
  return (getModel as (p: string, m: string) => Model<string>)(provider, modelId);
}
