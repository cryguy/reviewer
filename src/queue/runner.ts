import { generateText } from 'ai';
import { parseRepoFromUrl } from '../github/client.ts';
import { addReaction } from '../github/reactions.ts';
import { getPrDiff, getPrComments, getPrMetadata, listChangedFiles } from '../github/pr.ts';
import { postComment } from '../github/comments.ts';
import { postReview } from '../github/comments.ts';
import { cloneRepo } from '../tools/clone-repo.ts';
import { cleanupRepo } from '../tools/cleanup-repo.ts';
import { getFileContents } from '../tools/get-file-contents.ts';
import { searchCode } from '../tools/search-code.ts';
import { createClaudeAgent, createCodexAgent } from '../ai/agents.ts';
import { createOrchestratorProvider } from '../ai/providers.ts';
import { buildToolDefinitions, runOrchestrator } from '../ai/orchestrator.ts';
import { resolveSystemPrompt } from '../config.ts';
import { getDb, generateId } from '../db/index.ts';
import { updateRunStatus, getRunWithDetails } from '../db/runs.ts';
import { getMemoryForPR, addMemory } from '../db/memory.ts';
import { logger } from '../logger.ts';
import type { Run } from '../db/types.ts';
import type { Config } from '../config.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AppConfig = Config;

// ---------------------------------------------------------------------------
// executeRun — single run lifecycle
// ---------------------------------------------------------------------------

export async function executeRun(run: Run, config: AppConfig): Promise<void> {
  const { owner, repo, number } = parseRepoFromUrl(run.pr_url);
  const pat = config.bot.githubPAT;
  let clonedRepoPath: string | null = null;

  try {
    // 1. Update run status -> RUNNING
    updateRunStatus(run.id, 'running');

    // 2. Add rocket reaction to trigger comment
    await addReaction(pat, owner, repo, run.trigger_comment_id, 'rocket');

    // 3. Load conversation memory for this PR
    const memory = getMemoryForPR(run.pr_url);

    // 4. Resolve system prompt
    const fullRepo = `${owner}/${repo}`;
    const systemPrompt = resolveSystemPrompt(config, fullRepo, 'main');

    // 5. Build messages array: prior memory + current user message
    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

    for (const mem of memory) {
      if (mem.role === 'user' || mem.role === 'assistant') {
        messages.push({ role: mem.role, content: mem.content });
      }
    }

    messages.push({ role: 'user', content: run.trigger_body });

    // 6. Wire up all 12 tool handlers (pr_url-based params per spec)
    const tools = buildToolDefinitions({
      clone_repo: async (input: { pr_url: string }) => {
        const result = await cloneRepo(input, run.id, config.bot);
        clonedRepoPath = result.repo_path;
        return result;
      },

      cleanup_repo: async (input: { repo_path: string }) => {
        const result = await cleanupRepo(input, config.bot);
        if (input.repo_path === clonedRepoPath) {
          clonedRepoPath = null;
        }
        return result;
      },

      spawn_claude_cli: async (input: { repo_path: string; prompt: string }) => {
        return handleSpawnClaude(input, run, config);
      },

      spawn_codex_cli: async (input: { repo_path: string; prompt: string }) => {
        return handleSpawnCodex(input, run, config);
      },

      get_pr_diff: async (input: { pr_url: string }) => {
        const parsed = parseRepoFromUrl(input.pr_url);
        return getPrDiff(pat, parsed.owner, parsed.repo, parsed.number);
      },

      get_pr_comments: async (input: { pr_url: string }) => {
        const parsed = parseRepoFromUrl(input.pr_url);
        return getPrComments(pat, parsed.owner, parsed.repo, parsed.number);
      },

      get_pr_metadata: async (input: { pr_url: string }) => {
        const parsed = parseRepoFromUrl(input.pr_url);
        return getPrMetadata(pat, parsed.owner, parsed.repo, parsed.number);
      },

      list_changed_files: async (input: { pr_url: string }) => {
        const parsed = parseRepoFromUrl(input.pr_url);
        return listChangedFiles(pat, parsed.owner, parsed.repo, parsed.number);
      },

      get_file_contents: async (input: { repo_path: string; file_path: string }) => {
        return getFileContents(input);
      },

      search_code: async (input: { repo_path: string; query: string; file_glob?: string; max_results?: number }) => {
        return searchCode(input);
      },

      post_review: async (input: {
        pr_url: string;
        summary: string;
        inline_comments?: Array<{ path: string; line: number; body: string; side?: 'LEFT' | 'RIGHT' }>;
      }) => {
        const parsed = parseRepoFromUrl(input.pr_url);
        return postReview(pat, parsed.owner, parsed.repo, parsed.number, input.summary, input.inline_comments);
      },

      post_comment: async (input: { pr_url: string; body: string }) => {
        const parsed = parseRepoFromUrl(input.pr_url);
        return postComment(pat, parsed.owner, parsed.repo, parsed.number, input.body);
      },
    });

    // 7. Call orchestrator
    const model = createOrchestratorProvider(
      config.orchestrator.nanogptApiKey,
      config.orchestrator.model,
    );

    const result = await runOrchestrator({
      model,
      systemPrompt,
      messages,
      tools,
      maxSteps: config.bot.maxToolLoopSteps,
      timeoutMs: config.bot.runTimeoutMinutes * 60_000,
    });

    // 8. Store conversation memory
    addMemory({
      pr_url: run.pr_url,
      role: 'user',
      content: run.trigger_body,
      run_id: run.id,
    });

    if (result.text) {
      addMemory({
        pr_url: run.pr_url,
        role: 'assistant',
        content: result.text,
        run_id: run.id,
      });
    }

    // Store tool call memories
    if (result.steps) {
      for (const step of result.steps) {
        if (step.toolCalls) {
          for (const tc of step.toolCalls) {
            addMemory({
              pr_url: run.pr_url,
              role: 'tool',
              content: JSON.stringify(tc.args),
              tool_name: tc.toolName,
              tool_result: tc.result !== undefined ? JSON.stringify(tc.result) : undefined,
              run_id: run.id,
            });
          }
        }
      }
    }

    // 9. Update cost/tokens on the run record
    const totalTokens = result.usage
      ? (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0)
      : null;

    updateRunStatus(run.id, 'completed', {
      total_tokens: totalTokens ?? undefined,
    });

    // 10. Add checkmark reaction
    await addReaction(pat, owner, repo, run.trigger_comment_id, '+1');

    logger.info('Run completed successfully', { runId: run.id, totalTokens });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('Run failed', { runId: run.id, error: errorMessage });

    // Add failure reaction
    try {
      await addReaction(pat, owner, repo, run.trigger_comment_id, 'heart');
    } catch {
      // Ignore reaction failure
    }

    // Post failure comment on PR
    try {
      await postComment(
        pat,
        owner,
        repo,
        number,
        `**Review failed** for this run.\n\nError: ${errorMessage}`,
      );
    } catch {
      // Ignore comment failure
    }

    // Update status -> FAILED
    updateRunStatus(run.id, 'failed', { error: errorMessage });
  } finally {
    // Always attempt cleanup if a repo was cloned
    if (clonedRepoPath) {
      try {
        await cleanupRepo({ repo_path: clonedRepoPath }, config.bot);
      } catch {
        logger.warn('Failed to cleanup cloned repo in finally block', { repoPath: clonedRepoPath });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Agent spawn handlers
// ---------------------------------------------------------------------------

async function handleSpawnClaude(
  params: { repo_path: string; prompt: string },
  run: Run,
  config: AppConfig,
): Promise<{ output: string; exit_code: number; duration_ms: number; tokens_used: { prompt: number; completion: number } | null }> {
  const startMs = Date.now();
  const model = createClaudeAgent(params.repo_path, config.agents.claude);
  const { text, usage } = await generateText({
    model,
    prompt: params.prompt,
    abortSignal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const durationMs = Date.now() - startMs;

  // Store agent output in DB
  const db = getDb();
  db.query(
    `INSERT INTO agent_outputs (id, run_id, agent_type, prompt, raw_output, duration_ms, tokens_prompt, tokens_completion, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    generateId(),
    run.id,
    'claude',
    params.prompt,
    text,
    durationMs,
    usage?.inputTokens ?? null,
    usage?.outputTokens ?? null,
  );

  return {
    output: text,
    exit_code: 0,
    duration_ms: durationMs,
    tokens_used: usage
      ? { prompt: usage.inputTokens ?? 0, completion: usage.outputTokens ?? 0 }
      : null,
  };
}

async function handleSpawnCodex(
  params: { repo_path: string; prompt: string },
  run: Run,
  config: AppConfig,
): Promise<{ output: string; exit_code: number; duration_ms: number; tokens_used: { prompt: number; completion: number } | null }> {
  const startMs = Date.now();
  const { model } = createCodexAgent(params.repo_path, config.agents.codex);
  const { text, usage } = await generateText({
    model,
    prompt: params.prompt,
    abortSignal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const durationMs = Date.now() - startMs;

  // Store agent output in DB
  const db = getDb();
  db.query(
    `INSERT INTO agent_outputs (id, run_id, agent_type, prompt, raw_output, duration_ms, tokens_prompt, tokens_completion, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    generateId(),
    run.id,
    'codex',
    params.prompt,
    text,
    durationMs,
    usage?.inputTokens ?? null,
    usage?.outputTokens ?? null,
  );

  return {
    output: text,
    exit_code: 0,
    duration_ms: durationMs,
    tokens_used: usage
      ? { prompt: usage.inputTokens ?? 0, completion: usage.outputTokens ?? 0 }
      : null,
  };
}
