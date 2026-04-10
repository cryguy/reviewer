import * as fs from 'fs';
import { parseRepoFromUrl } from '../github/client.ts';
import { addReaction } from '../github/reactions.ts';
import { getPrDiff, getPrComments, getPrMetadata, listChangedFiles } from '../github/pr.ts';
import { postComment, postReview } from '../github/comments.ts';
import { cloneRepo } from '../tools/clone-repo.ts';
import { cleanupRepo } from '../tools/cleanup-repo.ts';
import { getFileContents } from '../tools/get-file-contents.ts';
import { searchCode } from '../tools/search-code.ts';
import { createClaudeAgent, createCodexAgent } from '../ai/agents.ts';
import { generateText } from 'ai';
import { createNanogptModel, createCodexResponsesModel, createStandardModel } from '../ai/providers.ts';
import { getCodexCredentials, getCodexApiKey } from '../ai/codex-oauth.ts';
import { buildToolDefinitions, runOrchestrator } from '../ai/orchestrator.ts';
import { resolveSystemPrompt } from '../config.ts';
import { getDb, generateId } from '../db/index.ts';
import { updateRunStatus, insertRunStep } from '../db/runs.ts';
import { getMemoryForPR, addMemory } from '../db/memory.ts';
import { logger } from '../logger.ts';
import type { Run } from '../db/types.ts';
import type { Config } from '../config.ts';

// ---------------------------------------------------------------------------
// Text-based tool call parser
// Some models output tool calls as XML text instead of structured calls.
// ---------------------------------------------------------------------------

function parseTextToolCall(text: string): { tool: string; args: Record<string, unknown> } | null {
  // Match <use_tool name="...">JSON</use_tool> or <use_tool name="...">JSON (unclosed)
  const match = text.match(/<use_tool\s+name="(post_to_pr)">\s*([\s\S]*?)(?:<\/use_tool>|$)/);
  if (!match) return null;

  try {
    // Extract the JSON — strip trailing ] or other artifacts
    let jsonStr = match[2]!.trim();
    if (jsonStr.endsWith(']')) {
      jsonStr = jsonStr.slice(0, -1).trim();
    }
    const args = JSON.parse(jsonStr) as Record<string, unknown>;
    return { tool: match[1]!, args };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// executeRun — single run lifecycle
// ---------------------------------------------------------------------------

export async function executeRun(run: Run, config: Config): Promise<void> {
  const { owner, repo, number } = parseRepoFromUrl(run.pr_url);
  const pat = config.bot.githubPAT;
  let clonedRepoPath: string | null = null;
  let reviewPosted = false;

  try {
    // 1. Update run status -> RUNNING
    updateRunStatus(run.id, 'running');

    // 2. Add rocket reaction to trigger comment
    await addReaction(pat, owner, repo, run.trigger_comment_id, 'rocket');

    // 3. Load conversation memory for this PR
    const memory = getMemoryForPR(run.pr_url);

    // 4. Resolve system prompt (fetch PR metadata to get actual head branch)
    const fullRepo = `${owner}/${repo}`;
    let headBranch = 'main';
    try {
      const prMeta = await getPrMetadata(pat, owner, repo, number);
      headBranch = prMeta.head_branch;
    } catch (err) {
      logger.warn('Could not fetch PR metadata for branch resolution, defaulting to main', {
        runId: run.id,
        error: String(err),
      });
    }
    const systemPrompt = resolveSystemPrompt(config, fullRepo, headBranch);

    // 5. Build messages array: prior memory (including tool calls) + current user message
    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

    for (const mem of memory) {
      if (mem.role === 'user' || mem.role === 'assistant') {
        messages.push({ role: mem.role, content: mem.content });
      } else if (mem.role === 'tool') {
        // Include tool call context as assistant messages so the orchestrator
        // has full history from prior interactions on this PR
        const toolContext = mem.tool_name
          ? `[Tool: ${mem.tool_name}] Args: ${mem.content}${mem.tool_result ? `\nResult: ${mem.tool_result}` : ''}`
          : mem.content;
        messages.push({ role: 'assistant', content: toolContext });
      }
    }

    // Context overflow protection: estimate tokens and truncate if approaching 250k
    const estimatedTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
    const TOKEN_LIMIT = 200_000; // leave headroom below 250k
    if (estimatedTokens > TOKEN_LIMIT) {
      logger.warn('Conversation memory approaching token limit, truncating oldest entries', {
        estimatedTokens,
        messageCount: messages.length,
      });
      while (messages.length > 1 && messages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0) > TOKEN_LIMIT) {
        messages.shift(); // remove oldest
      }
    }

    messages.push({
      role: 'user',
      content: `[PR: ${run.pr_url} | repo: ${owner}/${repo} | #${number} | triggered by @${run.trigger_user}]\n\n${run.trigger_body}`,
    });

    // 6. Wire up all 11 tool handlers (pr_url-based params per spec)
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
        if (!fs.existsSync(input.repo_path)) {
          return { error: 'REPO_NOT_CLONED', message: 'Repository path does not exist. You must call clone_repo first before spawning agents.' };
        }
        return handleSpawnClaude(input, run, config);
      },

      spawn_codex_cli: async (input: { repo_path: string; prompt: string }) => {
        if (!fs.existsSync(input.repo_path)) {
          return { error: 'REPO_NOT_CLONED', message: 'Repository path does not exist. You must call clone_repo first before spawning agents.' };
        }
        return handleSpawnCodex(input, run, config);
      },

      get_pr_diff: async (input: { pr_url: string }) => {
        const parsed = parseRepoFromUrl(input.pr_url);
        return getPrDiff(pat, parsed.owner, parsed.repo, parsed.number);
      },

      get_pr_comments: async (input: { pr_url: string }) => {
        const parsed = parseRepoFromUrl(input.pr_url);
        const comments = await getPrComments(pat, parsed.owner, parsed.repo, parsed.number);
        return { comments, total: comments.length };
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

      post_to_pr: async (input: {
        pr_url: string;
        type: 'review' | 'comment';
        body: string;
        inline_comments?: Array<{ path: string; line: number; body: string; side?: 'LEFT' | 'RIGHT' }>;
      }) => {
        const parsed = parseRepoFromUrl(input.pr_url);

        if (input.type === 'review') {
          // Guard: only one review per run
          if (reviewPosted) {
            return { skipped: true, reason: 'A review has already been posted for this run. Use type "comment" for follow-ups.' };
          }

          // Append dashboard run link if baseUrl is configured
          let body = input.body;
          if (config.dashboard.baseUrl) {
            body += `\n\n---\n*[View run details](${config.dashboard.baseUrl}/runs/${run.id})*`;
          }

          const result = await postReview(pat, parsed.owner, parsed.repo, parsed.number, body, input.inline_comments);
          reviewPosted = true;

          // Store review in the reviews table
          const db = getDb();
          db.query(
            `INSERT INTO reviews (id, run_id, summary, inline_comments, comment_id, comment_url, created_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
          ).run(
            generateId(),
            run.id,
            input.body,
            JSON.stringify(input.inline_comments ?? []),
            result.comment_id,
            result.comment_url,
          );

          return result;
        }

        // type === 'comment'
        return postComment(pat, parsed.owner, parsed.repo, parsed.number, input.body);
      },
    });

    // 7. Call orchestrator
    const { provider, model: modelId, apiKey: configApiKey } = config.orchestrator;
    logger.info('Creating orchestrator model', { provider, runId: run.id });

    let model;
    let apiKeyForAgent: string | undefined;
    if (provider === 'codex') {
      const credentials = await getCodexCredentials();
      model = createCodexResponsesModel(credentials, modelId);
      apiKeyForAgent = getCodexApiKey(credentials);
    } else if (provider === 'nanogpt') {
      model = createNanogptModel(configApiKey, modelId);
      apiKeyForAgent = configApiKey || undefined;
    } else {
      model = createStandardModel(provider, modelId);
      apiKeyForAgent = configApiKey || undefined;
    }

    logger.info('Starting orchestrator', { runId: run.id, messageCount: messages.length, maxSteps: config.bot.maxToolLoopSteps });
    let accumulatedTokens = { input: 0, output: 0 };
    let stepNumber = 0;

    const result = await runOrchestrator({
      model,
      systemPrompt,
      messages,
      tools,
      maxSteps: config.bot.maxToolLoopSteps,
      timeoutMs: config.bot.runTimeoutMinutes * 60_000,
      apiKey: apiKeyForAgent,
      onStepFinish: (step) => {
        stepNumber++;
        if (step.usage) {
          accumulatedTokens.input += step.usage.input;
          accumulatedTokens.output += step.usage.output;
        }

        // Persist step to DB for dashboard visibility
        insertRunStep(
          run.id,
          stepNumber,
          step.toolCalls,
          step.usage?.input ?? null,
          step.usage?.output ?? null,
        );

        if (step.toolCalls.length > 0) {
          logger.info('Orchestrator step completed', {
            runId: run.id,
            step: stepNumber,
            toolCalls: step.toolCalls.map((tc) => tc.toolName),
            stepTokens: step.usage ?? null,
          });
        }
      },
    });

    // 8. Fallback: if the orchestrator produced text but never called
    //    post_to_pr, retry with a follow-up turn so the model uses the
    //    proper tool instead of dumping raw text.
    const calledCommentTool = result.steps.some((s) =>
      s.toolCalls.some((tc) => tc.toolName === 'post_to_pr'),
    );
    if (!calledCommentTool && result.text) {
      logger.info('Orchestrator did not post via tool, retrying with follow-up turn', { runId: run.id });

      const retryMessages = [
        ...messages,
        { role: 'assistant' as const, content: result.text },
        {
          role: 'user' as const,
          content: 'You produced a response but did not call post_to_pr. You MUST call post_to_pr to post your response on the PR. Use type "review" if the response is a formal review; otherwise use type "comment". Post the response you already wrote.',
        },
      ];

      try {
        const retryResult = await runOrchestrator({
          model,
          systemPrompt,
          messages: retryMessages,
          tools,
          maxSteps: 3,
          timeoutMs: 60_000,
          apiKey: apiKeyForAgent,
        });

        const retryCalledTool = retryResult.steps.some((s) =>
          s.toolCalls.some((tc) => tc.toolName === 'post_to_pr'),
        );

        if (!retryCalledTool) {
          // Last resort: post the original text as a comment
          logger.warn('Retry also failed to use tool, posting as fallback comment', { runId: run.id });
          await postComment(pat, owner, repo, number, result.text);
        }
      } catch (retryErr) {
        logger.warn('Follow-up retry failed, posting as fallback comment', {
          runId: run.id,
          error: String(retryErr),
        });
        await postComment(pat, owner, repo, number, result.text);
      }
    }

    // 9. Store conversation memory
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
    for (const step of result.steps) {
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

    // 10. Update cost/tokens on the run record
    const totalTokens = result.usage
      ? result.usage.input + result.usage.output
      : null;

    updateRunStatus(run.id, 'completed', {
      total_tokens: totalTokens ?? undefined,
    });

    // 10. Add success reaction (🎉)
    await addReaction(pat, owner, repo, run.trigger_comment_id, 'hooray');

    logger.info('Run completed successfully', { runId: run.id, totalTokens });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('Run failed', { runId: run.id, error: errorMessage });

    // Add failure reaction (😕)
    try {
      await addReaction(pat, owner, repo, run.trigger_comment_id, 'confused');
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

type AgentResult = {
  output: string;
  exit_code: number;
  duration_ms: number;
  tokens_used: { prompt: number; completion: number } | null;
} | {
  error: { code: 'AGENT_TIMEOUT' | 'AGENT_CRASHED'; message: string };
  duration_ms: number;
};

async function handleSpawnClaude(
  params: { repo_path: string; prompt: string },
  run: Run,
  config: Config,
): Promise<AgentResult> {
  const startMs = Date.now();

  try {
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
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const message = err instanceof Error ? err.message : String(err);
    const code = (err instanceof Error && err.name === 'AbortError') ? 'AGENT_TIMEOUT' : 'AGENT_CRASHED';

    logger.error('Claude agent failed', { runId: run.id, code, error: message, durationMs });

    // Store failed agent output in DB
    const db = getDb();
    db.query(
      `INSERT INTO agent_outputs (id, run_id, agent_type, prompt, raw_output, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(generateId(), run.id, 'claude', params.prompt, `ERROR: ${message}`, durationMs);

    return { error: { code, message }, duration_ms: durationMs };
  }
}

async function handleSpawnCodex(
  params: { repo_path: string; prompt: string },
  run: Run,
  config: Config,
): Promise<AgentResult> {
  const startMs = Date.now();

  try {
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
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const message = err instanceof Error ? err.message : String(err);
    const code = (err instanceof Error && err.name === 'AbortError') ? 'AGENT_TIMEOUT' : 'AGENT_CRASHED';

    logger.error('Codex agent failed', { runId: run.id, code, error: message, durationMs });

    // Store failed agent output in DB
    const db = getDb();
    db.query(
      `INSERT INTO agent_outputs (id, run_id, agent_type, prompt, raw_output, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(generateId(), run.id, 'codex', params.prompt, `ERROR: ${message}`, durationMs);

    return { error: { code, message }, duration_ms: durationMs };
  }
}
