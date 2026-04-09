import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrchestratorParams {
  model: any; // from providers.ts
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  tools: Record<string, any>; // actual tool implementations passed in from runner.ts
  maxSteps: number;
  timeoutMs: number;
  onStepFinish?: (step: { toolCalls: any; usage: any }) => void;
}

export interface OrchestratorResult {
  text: string;
  usage: any;
  steps: any[];
  toolCalls: any;
  toolResults: any;
}

// ---------------------------------------------------------------------------
// Tool definitions matching the spec's 12 tools exactly.
// Parameters use pr_url (full GitHub PR URL) per spec, not owner/repo/number.
// Real execute functions are wired in runner.ts via buildToolDefinitions().
// ---------------------------------------------------------------------------

type ToolHandler<T = any> = (input: T) => Promise<any>;

type ToolHandlers = {
  clone_repo?: ToolHandler;
  cleanup_repo?: ToolHandler;
  spawn_codex_cli?: ToolHandler;
  spawn_claude_cli?: ToolHandler;
  get_pr_diff?: ToolHandler;
  get_pr_comments?: ToolHandler;
  get_pr_metadata?: ToolHandler;
  list_changed_files?: ToolHandler;
  get_file_contents?: ToolHandler;
  search_code?: ToolHandler;
  post_review?: ToolHandler;
  post_comment?: ToolHandler;
};

function notImplemented(name: string): ToolHandler {
  return () => Promise.reject(new Error(`Tool '${name}' not implemented`));
}

export function buildToolDefinitions(handlers: ToolHandlers): Record<string, any> {
  return {
    // --- Repo Management ---
    clone_repo: tool({
      description: 'Clone a PR\'s branch for analysis. Returns the local repo_path. Idempotent — returns existing path if already cloned for this run.',
      inputSchema: z.object({
        pr_url: z.string().describe('Full GitHub PR URL (e.g. https://github.com/org/repo/pull/123)'),
      }),
      execute: handlers.clone_repo ?? notImplemented('clone_repo'),
    }),

    cleanup_repo: tool({
      description: 'Delete a cloned repository from disk. Always call when done with a review.',
      inputSchema: z.object({
        repo_path: z.string().describe('Local path returned by clone_repo'),
      }),
      execute: handlers.cleanup_repo ?? notImplemented('cleanup_repo'),
    }),

    // --- Agent Spawning ---
    spawn_codex_cli: tool({
      description: 'Spawn a Codex agent to review code in the cloned repo. Pass a detailed review prompt. Returns the agent\'s findings as text.',
      inputSchema: z.object({
        repo_path: z.string().describe('Local path returned by clone_repo'),
        prompt: z.string().describe('Detailed review/analysis prompt for the Codex agent'),
      }),
      execute: handlers.spawn_codex_cli ?? notImplemented('spawn_codex_cli'),
    }),

    spawn_claude_cli: tool({
      description: 'Spawn a Claude Code agent to review code in the cloned repo. Pass a detailed review prompt. Returns the agent\'s findings as text.',
      inputSchema: z.object({
        repo_path: z.string().describe('Local path returned by clone_repo'),
        prompt: z.string().describe('Detailed review/analysis prompt for the Claude agent'),
      }),
      execute: handlers.spawn_claude_cli ?? notImplemented('spawn_claude_cli'),
    }),

    // --- PR Context ---
    get_pr_diff: tool({
      description: 'Fetch the full unified diff of the PR. Returns diff text and stats (additions, deletions, changed_files).',
      inputSchema: z.object({
        pr_url: z.string().describe('Full GitHub PR URL'),
      }),
      execute: handlers.get_pr_diff ?? notImplemented('get_pr_diff'),
    }),

    get_pr_comments: tool({
      description: 'Fetch all comments on the PR (issue comments, review comments, reviews). Sorted chronologically.',
      inputSchema: z.object({
        pr_url: z.string().describe('Full GitHub PR URL'),
      }),
      execute: handlers.get_pr_comments ?? notImplemented('get_pr_comments'),
    }),

    get_pr_metadata: tool({
      description: 'Fetch PR metadata: title, description, author, labels, reviewers, CI status, branches.',
      inputSchema: z.object({
        pr_url: z.string().describe('Full GitHub PR URL'),
      }),
      execute: handlers.get_pr_metadata ?? notImplemented('get_pr_metadata'),
    }),

    list_changed_files: tool({
      description: 'List all files changed in the PR with per-file addition/deletion stats and status (added, modified, removed, renamed).',
      inputSchema: z.object({
        pr_url: z.string().describe('Full GitHub PR URL'),
      }),
      execute: handlers.list_changed_files ?? notImplemented('list_changed_files'),
    }),

    // --- Repo Utilities (operate on clone) ---
    get_file_contents: tool({
      description: 'Read a specific file from the cloned repo. Use to examine files not shown in the diff.',
      inputSchema: z.object({
        repo_path: z.string().describe('Local path returned by clone_repo'),
        file_path: z.string().describe('Relative path within the repo (e.g. src/auth/middleware.ts)'),
      }),
      execute: handlers.get_file_contents ?? notImplemented('get_file_contents'),
    }),

    search_code: tool({
      description: 'Search for patterns in the cloned repo. Returns matching lines with 2 lines of context before/after.',
      inputSchema: z.object({
        repo_path: z.string().describe('Local path returned by clone_repo'),
        query: z.string().describe('Search pattern (fixed string)'),
        file_glob: z.string().optional().describe('Optional file pattern filter (e.g. *.ts, src/**/*.js)'),
        max_results: z.number().int().optional().describe('Max matches to return (default 50)'),
      }),
      execute: handlers.search_code ?? notImplemented('search_code'),
    }),

    // --- Actions ---
    post_review: tool({
      description: 'Post a review on the PR with summary and optional inline line-level comments. Use for formal code reviews.',
      inputSchema: z.object({
        pr_url: z.string().describe('Full GitHub PR URL'),
        summary: z.string().describe('Review summary (Markdown)'),
        inline_comments: z.array(z.object({
          path: z.string().describe('File path relative to repo root'),
          line: z.number().int().describe('Line number in the diff'),
          body: z.string().describe('Comment body (Markdown)'),
          side: z.enum(['LEFT', 'RIGHT']).optional().describe('Diff side (default RIGHT)'),
        })).optional().describe('Inline comments on specific lines'),
      }),
      execute: handlers.post_review ?? notImplemented('post_review'),
    }),

    post_comment: tool({
      description: 'Post a conversational comment on the PR. Use for replies, follow-ups, and acknowledgements — NOT for formal reviews.',
      inputSchema: z.object({
        pr_url: z.string().describe('Full GitHub PR URL'),
        body: z.string().describe('Comment body (Markdown)'),
      }),
      execute: handlers.post_comment ?? notImplemented('post_comment'),
    }),
  };
}

// ---------------------------------------------------------------------------
// Main orchestrator function
// ---------------------------------------------------------------------------

export async function runOrchestrator(params: OrchestratorParams): Promise<OrchestratorResult> {
  const result = await generateText({
    model: params.model,
    system: params.systemPrompt,
    messages: params.messages,
    tools: params.tools,
    stopWhen: stepCountIs(params.maxSteps),
    abortSignal: AbortSignal.timeout(params.timeoutMs),
    onStepFinish: params.onStepFinish,
  });

  return {
    text: result.text,
    usage: result.usage,
    steps: result.steps,
    toolCalls: result.toolCalls,
    toolResults: result.toolResults,
  };
}
