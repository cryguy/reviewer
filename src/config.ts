import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getDefaultSystemPrompt } from './ai/system-prompt.ts';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const BotConfigSchema = z.object({
  githubUsername: z.string(),
  githubPAT: z.string(),
  pollIntervalSeconds: z.number().int().positive().default(30),
  runTimeoutMinutes: z.number().int().positive().default(15),
  cloneBasePath: z.string().nullable().default(null),
  maxToolLoopSteps: z.number().int().positive().default(20),
});

const OrchestratorConfigSchema = z.object({
  provider: z.enum([
    'nanogpt', 'codex',
    'openai', 'anthropic', 'google', 'openrouter',
    'groq', 'mistral', 'xai',
  ]).default('codex'),
  apiKey: z.string().optional().default(''),
  model: z.string(),
  systemPrompt: z.string().nullable().default(null),
  repoOverrides: z.record(z.string(), z.string()).default({}),
});

const CodexAgentConfigSchema = z.object({
  model: z.string(),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).default('high'),
  sandboxMode: z.enum(['read-only', 'full']).default('read-only'),
});

const ClaudeAgentConfigSchema = z.object({
  model: z.string(),
  allowedTools: z.array(z.string()).default(['Read', 'Glob', 'Grep']),
  permissionMode: z.string().default('bypassPermissions'),
});

const AgentsConfigSchema = z.object({
  codex: CodexAgentConfigSchema,
  claude: ClaudeAgentConfigSchema,
});

const DashboardConfigSchema = z.object({
  port: z.number().int().positive().default(3000),
  auth: z.record(z.string(), z.string()).default({}),
  baseUrl: z.string().optional().default(''),
});

const ConfigSchema = z.object({
  bot: BotConfigSchema,
  orchestrator: OrchestratorConfigSchema,
  agents: AgentsConfigSchema,
  whitelist: z.array(z.string()).default([]),
  dashboard: DashboardConfigSchema,
});

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type BotConfig = z.infer<typeof BotConfigSchema>;
export type CodexAgentConfig = z.infer<typeof CodexAgentConfigSchema>;
export type ClaudeAgentConfig = z.infer<typeof ClaudeAgentConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

// ---------------------------------------------------------------------------
// Glob matching (supports * and **)
// ---------------------------------------------------------------------------

function globToRegex(pattern: string): RegExp {
  // Escape regex special chars except * which we handle specially
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§DOUBLESTAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/§DOUBLESTAR§/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesGlob(value: string, pattern: string): boolean {
  return globToRegex(pattern).test(value);
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

const PROJECT_ROOT = process.cwd();

export function loadConfig(): Config {
  const configPath = path.join(PROJECT_ROOT, 'config.json');

  let raw: unknown;
  try {
    const text = fs.readFileSync(configPath, 'utf-8');
    raw = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config.json: ${message}`);
  }

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`config.json validation failed:\n${issues}`);
  }

  const config = result.data;

  // Resolve cloneBasePath default
  if (config.bot.cloneBasePath === null) {
    (config.bot as { cloneBasePath: string | null }).cloneBasePath = path.join(
      os.tmpdir(),
      'reviewer-cache',
    );
  }

  return config;
}

// ---------------------------------------------------------------------------
// System prompt resolution
// ---------------------------------------------------------------------------

export function resolveSystemPrompt(
  config: Config,
  repo: string,
  branch: string,
): string {
  const overrides = config.orchestrator.repoOverrides;

  // 1. Check repo:branch exact key
  const repoAndBranchKey = `${repo}:${branch}`;
  if (repoAndBranchKey in overrides) {
    return overrides[repoAndBranchKey]!;
  }

  // 2. Check repo:branch glob patterns
  for (const [pattern, prompt] of Object.entries(overrides)) {
    if (pattern.includes(':') && matchesGlob(repoAndBranchKey, pattern)) {
      return prompt;
    }
  }

  // 3. Check repo exact key
  if (repo in overrides) {
    return overrides[repo]!;
  }

  // 4. Check repo glob patterns (no colon)
  for (const [pattern, prompt] of Object.entries(overrides)) {
    if (!pattern.includes(':') && matchesGlob(repo, pattern)) {
      return prompt;
    }
  }

  // 5. Fall back to orchestrator.systemPrompt
  if (config.orchestrator.systemPrompt !== null) {
    return config.orchestrator.systemPrompt;
  }

  // 6. Hardcoded default (comprehensive prompt with tool instructions, synthesis format, etc.)
  return getDefaultSystemPrompt();
}
