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
// Tool definitions with Zod schemas
// These are placeholder stubs — real execute functions are wired in runner.ts
// via the buildToolDefinitions() export below.
// ---------------------------------------------------------------------------

type ToolHandler<T = any> = (input: T) => Promise<any>;

type ToolHandlers = {
  get_pr_metadata?: ToolHandler;
  get_pr_diff?: ToolHandler;
  get_changed_files?: ToolHandler;
  get_pr_comments?: ToolHandler;
  post_comment?: ToolHandler;
  post_review?: ToolHandler;
  add_reaction?: ToolHandler;
  clone_repo?: ToolHandler;
  spawn_claude_cli?: ToolHandler;
  spawn_codex_cli?: ToolHandler;
  cleanup_repo?: ToolHandler;
  get_run_status?: ToolHandler;
};

function notImplemented(name: string): ToolHandler {
  return () => Promise.reject(new Error(`Tool '${name}' not implemented`));
}

export function buildToolDefinitions(handlers: ToolHandlers): Record<string, any> {
  return {
    get_pr_metadata: tool({
      description:
        'Retrieve PR metadata including title, description, author, labels, CI status, and branch info.',
      inputSchema: z.object({
        owner: z.string().describe('Repository owner'),
        repo: z.string().describe('Repository name'),
        number: z.number().int().describe('PR number'),
      }),
      execute: handlers.get_pr_metadata ?? notImplemented('get_pr_metadata'),
    }),

    get_pr_diff: tool({
      description: 'Retrieve the full unified diff for the pull request.',
      inputSchema: z.object({
        owner: z.string().describe('Repository owner'),
        repo: z.string().describe('Repository name'),
        number: z.number().int().describe('PR number'),
      }),
      execute: handlers.get_pr_diff ?? notImplemented('get_pr_diff'),
    }),

    get_changed_files: tool({
      description: 'List all files changed in the PR with addition/deletion counts.',
      inputSchema: z.object({
        owner: z.string().describe('Repository owner'),
        repo: z.string().describe('Repository name'),
        number: z.number().int().describe('PR number'),
      }),
      execute: handlers.get_changed_files ?? notImplemented('get_changed_files'),
    }),

    get_pr_comments: tool({
      description: 'Retrieve all existing comments and reviews on the PR.',
      inputSchema: z.object({
        owner: z.string().describe('Repository owner'),
        repo: z.string().describe('Repository name'),
        number: z.number().int().describe('PR number'),
      }),
      execute: handlers.get_pr_comments ?? notImplemented('get_pr_comments'),
    }),

    post_comment: tool({
      description:
        'Post a plain comment on the PR. Use for conversational replies and acknowledgements, not for formal reviews.',
      inputSchema: z.object({
        owner: z.string().describe('Repository owner'),
        repo: z.string().describe('Repository name'),
        number: z.number().int().describe('PR number'),
        body: z.string().describe('Comment body (Markdown supported)'),
      }),
      execute: handlers.post_comment ?? notImplemented('post_comment'),
    }),

    post_review: tool({
      description:
        'Post a formal GitHub review with summary and optional inline comments. Use only for complete code reviews.',
      inputSchema: z.object({
        owner: z.string().describe('Repository owner'),
        repo: z.string().describe('Repository name'),
        number: z.number().int().describe('PR number'),
        summary: z.string().describe('Review summary body (Markdown supported)'),
        inline_comments: z
          .array(
            z.object({
              path: z.string().describe('File path relative to repo root'),
              line: z.number().int().describe('Line number in the diff'),
              body: z.string().describe('Inline comment body'),
              side: z.enum(['LEFT', 'RIGHT']).optional().describe('Diff side (default RIGHT)'),
            }),
          )
          .default([])
          .describe('Inline review comments'),
        event: z
          .enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES'])
          .default('COMMENT')
          .describe('Review event type'),
      }),
      execute: handlers.post_review ?? notImplemented('post_review'),
    }),

    add_reaction: tool({
      description:
        "Add an emoji reaction to a PR comment (e.g. 'eyes' to signal working, 'rocket' when done).",
      inputSchema: z.object({
        owner: z.string().describe('Repository owner'),
        repo: z.string().describe('Repository name'),
        comment_id: z.number().int().describe('Comment ID to react to'),
        reaction: z.enum(['eyes', 'rocket', '+1', 'heart']).describe('Reaction type'),
      }),
      execute: handlers.add_reaction ?? notImplemented('add_reaction'),
    }),

    clone_repo: tool({
      description:
        'Clone the repository to a local temporary path. Required before spawning agents.',
      inputSchema: z.object({
        owner: z.string().describe('Repository owner'),
        repo: z.string().describe('Repository name'),
        ref: z.string().describe('Branch, tag, or commit SHA to check out'),
      }),
      execute: handlers.clone_repo ?? notImplemented('clone_repo'),
    }),

    spawn_claude_cli: tool({
      description:
        'Spawn a Claude Code agent scoped to the cloned repository to perform code analysis.',
      inputSchema: z.object({
        repo_path: z.string().describe('Local path to the cloned repository'),
        prompt: z.string().describe('Detailed prompt for the Claude agent'),
      }),
      execute: handlers.spawn_claude_cli ?? notImplemented('spawn_claude_cli'),
    }),

    spawn_codex_cli: tool({
      description:
        'Spawn a Codex agent scoped to the cloned repository to perform code analysis.',
      inputSchema: z.object({
        repo_path: z.string().describe('Local path to the cloned repository'),
        prompt: z.string().describe('Detailed prompt for the Codex agent'),
      }),
      execute: handlers.spawn_codex_cli ?? notImplemented('spawn_codex_cli'),
    }),

    cleanup_repo: tool({
      description:
        'Delete the cloned repository from local disk. Always call this after agents finish.',
      inputSchema: z.object({
        repo_path: z.string().describe('Local path of the cloned repository to delete'),
      }),
      execute: handlers.cleanup_repo ?? notImplemented('cleanup_repo'),
    }),

    get_run_status: tool({
      description: 'Check the current run status, token usage, and elapsed time.',
      inputSchema: z.object({
        run_id: z.string().describe('Run ID to check'),
      }),
      execute: handlers.get_run_status ?? notImplemented('get_run_status'),
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
