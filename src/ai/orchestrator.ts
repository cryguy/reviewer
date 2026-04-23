import { Type, type Model, type Usage, type AssistantMessage, type Message } from '@mariozechner/pi-ai';
import { Agent, type AgentTool, type AgentToolResult } from '@mariozechner/pi-agent-core';

// ---------------------------------------------------------------------------
// Concrete types for orchestrator results.
// Consumers use these instead of the internal pi-ai generics.
// ---------------------------------------------------------------------------

/** A single tool call extracted from an orchestrator step. */
export interface OrchestratorToolCall {
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
}

/** A single orchestrator step (one LLM round-trip). */
export interface OrchestratorStep {
  toolCalls: OrchestratorToolCall[];
  usage: { input: number; output: number } | undefined;
  assistantText: string;
  reasoning: string | null;
  stopReason: string | null;
}

export interface OrchestratorParams {
  model: Model<string>;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  tools: AgentTool[];
  maxSteps: number;
  timeoutMs: number;
  apiKey?: string;
  onStepFinish?: (step: OrchestratorStep) => void | Promise<void>;
}

export interface OrchestratorResult {
  text: string;
  usage: { input: number; output: number } | null;
  steps: OrchestratorStep[];
}

// ---------------------------------------------------------------------------
// Tool definitions matching the spec's 11 tools exactly.
// Parameters use pr_url (full GitHub PR URL) per spec, not owner/repo/number.
// Real execute functions are wired in runner.ts via buildToolDefinitions().
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- handlers receive validated input; the schema enforces the shape at runtime
type ToolHandler = (input: any) => Promise<unknown>;

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
  post_to_pr?: ToolHandler;
};

function notImplemented(name: string): ToolHandler {
  return () => Promise.reject(new Error(`Tool '${name}' not implemented`));
}

/** Wrap a plain handler into an AgentTool execute function. */
function wrapHandler(handler: ToolHandler): AgentTool['execute'] {
  return async (_toolCallId, params) => {
    const result = await handler(params);
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    return { content: [{ type: 'text' as const, text }], details: {} };
  };
}

export function buildToolDefinitions(handlers: ToolHandlers): AgentTool[] {
  return [
    // --- Repo Management ---
    {
      name: 'clone_repo',
      label: 'Clone Repository',
      description: 'Clone a PR\'s branch for analysis. Returns the local repo_path. Idempotent — returns existing path if already cloned for this run.',
      parameters: Type.Object({
        pr_url: Type.String({ description: 'Full GitHub PR URL (e.g. https://github.com/org/repo/pull/123)' }),
      }),
      execute: wrapHandler(handlers.clone_repo ?? notImplemented('clone_repo')),
    },
    {
      name: 'cleanup_repo',
      label: 'Cleanup Repository',
      description: 'Delete a cloned repository from disk. Always call when done with a review.',
      parameters: Type.Object({
        repo_path: Type.String({ description: 'Local path returned by clone_repo' }),
      }),
      execute: wrapHandler(handlers.cleanup_repo ?? notImplemented('cleanup_repo')),
    },

    // --- Agent Spawning ---
    {
      name: 'spawn_codex_cli',
      label: 'Spawn Codex Agent',
      description: 'Spawn a Codex agent to review code in the cloned repo. Pass a detailed review prompt. Returns the agent\'s findings as text.',
      parameters: Type.Object({
        repo_path: Type.String({ description: 'Local path returned by clone_repo' }),
        prompt: Type.String({ description: 'Detailed review/analysis prompt for the Codex agent' }),
      }),
      execute: wrapHandler(handlers.spawn_codex_cli ?? notImplemented('spawn_codex_cli')),
    },
    {
      name: 'spawn_claude_cli',
      label: 'Spawn Claude Agent',
      description: 'Spawn a Claude Code agent to review code in the cloned repo. Pass a detailed review prompt. Returns the agent\'s findings as text.',
      parameters: Type.Object({
        repo_path: Type.String({ description: 'Local path returned by clone_repo' }),
        prompt: Type.String({ description: 'Detailed review/analysis prompt for the Claude agent' }),
      }),
      execute: wrapHandler(handlers.spawn_claude_cli ?? notImplemented('spawn_claude_cli')),
    },

    // --- PR Context ---
    {
      name: 'get_pr_diff',
      label: 'Get PR Diff',
      description: 'Fetch the full unified diff of the PR. Returns diff text and stats (additions, deletions, changed_files).',
      parameters: Type.Object({
        pr_url: Type.String({ description: 'Full GitHub PR URL' }),
      }),
      execute: wrapHandler(handlers.get_pr_diff ?? notImplemented('get_pr_diff')),
    },
    {
      name: 'get_pr_comments',
      label: 'Get PR Comments',
      description: 'Fetch all comments on the PR (issue comments, review comments, reviews). Sorted chronologically.',
      parameters: Type.Object({
        pr_url: Type.String({ description: 'Full GitHub PR URL' }),
      }),
      execute: wrapHandler(handlers.get_pr_comments ?? notImplemented('get_pr_comments')),
    },
    {
      name: 'get_pr_metadata',
      label: 'Get PR Metadata',
      description: 'Fetch PR metadata: title, description, author, labels, reviewers, CI status, branches.',
      parameters: Type.Object({
        pr_url: Type.String({ description: 'Full GitHub PR URL' }),
      }),
      execute: wrapHandler(handlers.get_pr_metadata ?? notImplemented('get_pr_metadata')),
    },
    {
      name: 'list_changed_files',
      label: 'List Changed Files',
      description: 'List all files changed in the PR with per-file addition/deletion stats and status (added, modified, removed, renamed).',
      parameters: Type.Object({
        pr_url: Type.String({ description: 'Full GitHub PR URL' }),
      }),
      execute: wrapHandler(handlers.list_changed_files ?? notImplemented('list_changed_files')),
    },

    // --- Repo Utilities (operate on clone) ---
    {
      name: 'get_file_contents',
      label: 'Get File Contents',
      description: 'Read a specific file from the cloned repo. Use to examine files not shown in the diff.',
      parameters: Type.Object({
        repo_path: Type.String({ description: 'Local path returned by clone_repo' }),
        file_path: Type.String({ description: 'Relative path within the repo (e.g. src/auth/middleware.ts)' }),
      }),
      execute: wrapHandler(handlers.get_file_contents ?? notImplemented('get_file_contents')),
    },
    {
      name: 'search_code',
      label: 'Search Code',
      description: 'Search for patterns in the cloned repo. Returns matching lines with 2 lines of context before/after.',
      parameters: Type.Object({
        repo_path: Type.String({ description: 'Local path returned by clone_repo' }),
        query: Type.String({ description: 'Search pattern (fixed string)' }),
        file_glob: Type.Optional(Type.String({ description: 'Optional file pattern filter (e.g. *.ts, src/**/*.js)' })),
        max_results: Type.Optional(Type.Integer({ description: 'Max matches to return (default 50)' })),
      }),
      execute: wrapHandler(handlers.search_code ?? notImplemented('search_code')),
    },

    // --- Actions ---
    {
      name: 'post_to_pr',
      label: 'Post to PR',
      description:
        'Post to the PR. Set type to "review" for a formal code review (with optional inline comments) or "comment" for a conversational reply / follow-up. Only ONE review is allowed per run — subsequent review calls are rejected.',
      parameters: Type.Object({
        pr_url: Type.String({ description: 'Full GitHub PR URL' }),
        type: Type.Union([Type.Literal('review'), Type.Literal('comment')], {
          description: '"review" for formal code reviews, "comment" for conversational replies',
        }),
        body: Type.String({ description: 'Review summary or comment body (Markdown)' }),
        inline_comments: Type.Optional(Type.Array(Type.Object({
          path: Type.String({ description: 'File path relative to repo root' }),
          line: Type.Integer({ description: 'Line number in the diff' }),
          body: Type.String({ description: 'Comment body (Markdown)' }),
          side: Type.Optional(Type.Union([Type.Literal('LEFT'), Type.Literal('RIGHT')], { description: 'Diff side (default RIGHT)' })),
        }), { description: 'Inline comments on specific lines (only used when type is "review")' })),
      }),
      execute: wrapHandler(handlers.post_to_pr ?? notImplemented('post_to_pr')),
    },
  ];
}

// ---------------------------------------------------------------------------
// History message conversion
// ---------------------------------------------------------------------------

const EMPTY_USAGE: Usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Convert simple role/content history entries into pi-ai Message objects. */
function historyToMessages(messages: Array<{ role: string; content: string }>): Message[] {
  return messages.map((m) => {
    if (m.role === 'assistant') {
      return {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: m.content }],
        api: 'unknown',
        provider: 'unknown',
        model: 'unknown',
        usage: EMPTY_USAGE,
        stopReason: 'stop' as const,
        timestamp: Date.now(),
      } satisfies AssistantMessage;
    }
    // user, system, and any other role → UserMessage
    return { role: 'user' as const, content: m.content, timestamp: Date.now() };
  });
}

// ---------------------------------------------------------------------------
// Main orchestrator function
// ---------------------------------------------------------------------------

export async function runOrchestrator(params: OrchestratorParams): Promise<OrchestratorResult> {
  const steps: OrchestratorStep[] = [];
  const totalUsage = { input: 0, output: 0 };
  const MAX_COMMENTS = 5;
  let toolCallCount = 0;
  let commentCount = 0;
  let finalText = '';

  // Separate conversation history from the newest user message
  const history = params.messages.slice(0, -1);
  const lastMessage = params.messages[params.messages.length - 1]!;

  console.log(`[orchestrator] Model: ${params.model.id}, System prompt length: ${params.systemPrompt.length}, Messages: ${params.messages.length}, Tools: ${params.tools.length}, Max steps: ${params.maxSteps}, Timeout: ${params.timeoutMs}ms`);

  // Tools that use the cloned repo (must wait for clone_repo, must finish before cleanup_repo)
  const REPO_USING_TOOLS = new Set([
    'spawn_claude_cli', 'spawn_codex_cli',
    'get_file_contents', 'search_code',
  ]);
  let cloneReady = false;
  // Track in-flight repo-using tools so cleanup_repo doesn't race with them
  let pendingRepoTools = 0;

  const agent = new Agent({
    initialState: {
      systemPrompt: params.systemPrompt,
      model: params.model,
      thinkingLevel: 'high',
      tools: params.tools,
      messages: historyToMessages(history),
    },
    toolExecution: 'parallel',
    getApiKey: params.apiKey ? async () => params.apiKey : undefined,
    beforeToolCall: async ({ toolCall, args }) => {
      // Gate: block repo-using tools until clone_repo has completed
      if (REPO_USING_TOOLS.has(toolCall.name) && !cloneReady) {
        return {
          block: true,
          reason: `Tool "${toolCall.name}" requires a cloned repository. Call clone_repo first, then retry.`,
        };
      }

      // Gate: block cleanup_repo until clone is ready AND no repo-using tools are pending
      if (toolCall.name === 'cleanup_repo') {
        if (!cloneReady) {
          return { block: true, reason: 'No repository to clean up. Call clone_repo first.' };
        }
        if (pendingRepoTools > 0) {
          return {
            block: true,
            reason: `cleanup_repo blocked: ${pendingRepoTools} repo tool(s) still running. Call cleanup_repo in a separate turn after they finish.`,
          };
        }
      }

      // Track pending repo-using tools for cleanup serialization
      if (REPO_USING_TOOLS.has(toolCall.name)) {
        pendingRepoTools++;
      }

      if (toolCall.name === 'post_to_pr') {
        const parsedArgs = args as Record<string, unknown> | undefined;
        if (parsedArgs?.type === 'comment') {
          commentCount++;
          if (commentCount > MAX_COMMENTS) {
            return { block: true, reason: `Comment limit (${MAX_COMMENTS}) reached` };
          }
        }
        return;
      }
      toolCallCount++;
      if (toolCallCount > params.maxSteps) {
        return { block: true, reason: `Tool-call limit (${params.maxSteps}) reached` };
      }
    },
    afterToolCall: async ({ toolCall, isError }) => {
      // Decrement pending counter when repo-using tools finish
      if (REPO_USING_TOOLS.has(toolCall.name)) {
        pendingRepoTools = Math.max(0, pendingRepoTools - 1);
      }
      // Mark clone as ready once clone_repo succeeds
      if (toolCall.name === 'clone_repo' && !isError) {
        cloneReady = true;
      }
      // Mark clone as gone after cleanup
      if (toolCall.name === 'cleanup_repo' && !isError) {
        cloneReady = false;
      }
      return undefined;
    },
  });

  // Track tool calls per turn so we can build OrchestratorStep objects.
  let currentTurnToolCalls: OrchestratorToolCall[] = [];
  const pendingToolArgs = new Map<string, Record<string, unknown>>();

  agent.subscribe(async (event) => {
    switch (event.type) {
      case 'turn_start':
        currentTurnToolCalls = [];
        break;

      case 'tool_execution_start':
        pendingToolArgs.set(event.toolCallId, event.args as Record<string, unknown>);
        break;

      case 'tool_execution_end': {
        const args = pendingToolArgs.get(event.toolCallId) ?? {};
        pendingToolArgs.delete(event.toolCallId);

        // Unwrap the AgentToolResult content back to a plain value
        let resultValue: unknown;
        const res = event.result as AgentToolResult<unknown> | undefined;
        if (res?.content) {
          const joined = res.content
            .filter((c: { type: string }) => c.type === 'text')
            .map((c: { type: string; text?: string }) => (c as { text: string }).text)
            .join('');
          try { resultValue = JSON.parse(joined); } catch { resultValue = joined; }
        }
        currentTurnToolCalls.push({
          toolName: event.toolName,
          args,
          result: resultValue,
        });
        break;
      }

      case 'turn_end': {
        const msg = event.message as AssistantMessage | undefined;
        const turnUsage = msg?.usage
          ? { input: msg.usage.input, output: msg.usage.output }
          : undefined;
        if (turnUsage) {
          totalUsage.input += turnUsage.input;
          totalUsage.output += turnUsage.output;
        }

        // Extract the assistant's text + reasoning + stop reason for this turn.
        // pi-ai delivers AssistantMessage.content as an array of TextContent /
        // ThinkingContent / ToolCall — we collapse the first two into strings
        // and drop tool calls (already captured via tool_execution_end events).
        let assistantText = '';
        let reasoning: string | null = null;
        let stopReason: string | null = null;
        if (msg) {
          assistantText = msg.content
            .filter((c) => c.type === 'text')
            .map((c) => (c as { text: string }).text)
            .join('');
          const thinkingParts = msg.content
            .filter((c) => c.type === 'thinking')
            .map((c) => (c as { thinking: string }).thinking);
          reasoning = thinkingParts.length > 0 ? thinkingParts.join('\n') : null;
          stopReason = msg.stopReason ?? null;
        }

        const step: OrchestratorStep = {
          toolCalls: [...currentTurnToolCalls],
          usage: turnUsage,
          assistantText,
          reasoning,
          stopReason,
        };
        steps.push(step);
        console.log(
          `[orchestrator] Step ${steps.length} finished — ${step.toolCalls.length} tool calls, ` +
          `usage: ${turnUsage ? `${turnUsage.input}/${turnUsage.output}` : 'n/a'}`,
        );
        if (params.onStepFinish) {
          await params.onStepFinish(step);
        }
        break;
      }

      case 'agent_end': {
        // Walk backward through messages to find the last assistant text
        for (let i = event.messages.length - 1; i >= 0; i--) {
          const m = event.messages[i] as Message;
          if (m.role === 'assistant') {
            finalText = (m as AssistantMessage).content
              .filter((c) => c.type === 'text')
              .map((c) => (c as { text: string }).text)
              .join('');
            break;
          }
        }
        break;
      }
    }
  });

  // Abort on timeout
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    agent.abort();
  }, params.timeoutMs);

  try {
    await agent.prompt(lastMessage.content);
    await agent.waitForIdle();
  } finally {
    clearTimeout(timeout);
  }

  if (agent.state.errorMessage) {
    const reason = timedOut
      ? `Orchestrator timed out after ${params.timeoutMs}ms`
      : `Orchestrator error: ${agent.state.errorMessage}`;
    throw new Error(reason);
  }

  console.log(`[orchestrator] Completed — ${steps.length} total steps, final text length: ${finalText.length}`);

  return {
    text: finalText,
    usage: totalUsage.input > 0 || totalUsage.output > 0 ? totalUsage : null,
    steps,
  };
}
