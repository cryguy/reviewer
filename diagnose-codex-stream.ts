/**
 * Diagnostic script for handleSpawnCodex jumbled-output bug.
 *
 * Reproduces the issue and demonstrates the fix on the same single Codex run.
 * One pass over result.fullStream produces two outputs side by side:
 *   - assembled-text-raw.md      what await result.text gives you (current bug)
 *   - assembled-text-fixed.md    what streamCodexText() produces (the fix)
 *
 * Run:   bun run diagnose-codex-stream.ts
 * Out:   out/codex-diagnostic/
 *          repo/                       cloned target
 *          stream-trace.jsonl          one JSON per stream part
 *          assembled-text-raw.md       jumbled (provider's flat concat)
 *          assembled-text-fixed.md     boundary-aware concat
 *          summary.json                metrics + comparison
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { streamText } from 'ai';
import { createCodexAgent } from './src/ai/agents.ts';
import { loadConfig } from './src/config.ts';

const PR_REPO_URL = 'https://github.com/jaylim/defi.git';
const PR_NUMBER = 19;
const OUT_DIR = path.resolve('out/codex-diagnostic');
const REPO_DIR = path.join(OUT_DIR, 'repo');
const TRACE_PATH = path.join(OUT_DIR, 'stream-trace.jsonl');
const RAW_TEXT_PATH = path.join(OUT_DIR, 'assembled-text-raw.md');
const FIXED_TEXT_PATH = path.join(OUT_DIR, 'assembled-text-fixed.md');
const SUMMARY_PATH = path.join(OUT_DIR, 'summary.json');

const TOOL_EVENT_TYPES = new Set([
  'tool-call',
  'tool-result',
  'tool-error',
  'tool-input-start',
  'tool-input-delta',
  'tool-input-end',
]);

// ---------------------------------------------------------------------------
// 1. Prepare workspace and check out PR head
// ---------------------------------------------------------------------------

function run(cmd: string, args: string[], cwd?: string): void {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

if (!fs.existsSync(REPO_DIR)) {
  console.log(`[diag] Cloning ${PR_REPO_URL} into ${REPO_DIR}`);
  run('git', ['clone', '--depth=1', PR_REPO_URL, REPO_DIR]);
  console.log(`[diag] Fetching PR #${PR_NUMBER} head`);
  run('git', ['fetch', '--depth=1', 'origin', `pull/${PR_NUMBER}/head:pr-${PR_NUMBER}`], REPO_DIR);
  run('git', ['checkout', `pr-${PR_NUMBER}`], REPO_DIR);
} else {
  console.log(`[diag] Reusing existing clone at ${REPO_DIR}`);
}

// ---------------------------------------------------------------------------
// 2. Build the same codex agent the runner uses
// ---------------------------------------------------------------------------

const config = loadConfig();
console.log('[diag] Codex agent config:', config.agents.codex);

const { model } = createCodexAgent(REPO_DIR, config.agents.codex);

// ---------------------------------------------------------------------------
// 3. Compose a realistic review prompt — same shape spawn_codex_cli receives
// ---------------------------------------------------------------------------

const prompt = `You are reviewing a pull request as a senior engineer.

The repository has been cloned and the PR head branch is checked out at: ${REPO_DIR}
PR: jaylim/defi#${PR_NUMBER}

Analyze the changed files versus the merge-base with the default branch. For each finding, report:
- File and line number
- Severity (critical / major / minor)
- Issue description
- Suggested fix

Focus on: correctness bugs, security issues, race conditions, unhandled errors. Skip style nits.

Return your full review as Markdown.`;

// ---------------------------------------------------------------------------
// 4. Stream once, build both raw and boundary-aware assemblies in parallel
// ---------------------------------------------------------------------------

console.log('[diag] Starting streamText…');
const startedAt = Date.now();

const result = streamText({
  model,
  prompt,
  abortSignal: AbortSignal.timeout(10 * 60 * 1000),
});

const traceFh = fs.openSync(TRACE_PATH, 'w');
const typeCounts: Record<string, number> = {};

// Raw assembly — mirrors what `await result.text` gives us (provider's flat concat).
let rawText = '';

// Boundary-aware assembly — flush a segment whenever a text-delta follows tool-* events.
const segments: string[] = [];
let currentSegment = '';
let sawToolSinceLastText = false;

let textDeltaCount = 0;
let totalTextChars = 0;
let partIdx = 0;

for await (const part of result.fullStream) {
  const ts = Date.now() - startedAt;
  typeCounts[part.type] = (typeCounts[part.type] ?? 0) + 1;

  if (part.type === 'text-delta') {
    textDeltaCount++;
    totalTextChars += part.text.length;

    rawText += part.text;

    if (sawToolSinceLastText && currentSegment) {
      segments.push(currentSegment);
      currentSegment = '';
    }
    currentSegment += part.text;
    sawToolSinceLastText = false;
  } else if (TOOL_EVENT_TYPES.has(part.type)) {
    sawToolSinceLastText = true;
  }

  // Trace every part so we can audit later.
  const p = part as Record<string, unknown>;
  fs.writeSync(
    traceFh,
    JSON.stringify({
      idx: partIdx++,
      ts_ms: ts,
      type: part.type,
      id: p.id ?? null,
      text_len: part.type === 'text-delta' ? part.text.length : null,
      text_preview:
        part.type === 'text-delta'
          ? part.text.length > 80
            ? part.text.slice(0, 80) + '…'
            : part.text
          : null,
      tool_name: p.toolName ?? null,
    }) + '\n',
  );

  // Live console (one line per non-noise event)
  if (part.type !== 'tool-input-delta') {
    const tag = part.type.padEnd(20);
    const detail =
      part.type === 'text-delta'
        ? ` [${part.text.length}c] ${JSON.stringify(part.text.length > 60 ? part.text.slice(0, 60) + '…' : part.text)}`
        : 'toolName' in p && typeof p.toolName === 'string'
          ? ` tool=${p.toolName}`
          : '';
    console.log(`[+${String(ts).padStart(6)}ms] #${String(partIdx - 1).padStart(3)} ${tag}${detail}`);
  }
}
if (currentSegment) segments.push(currentSegment);
fs.closeSync(traceFh);

const fixedText = segments.join('\n\n');

// ---------------------------------------------------------------------------
// 5. Persist outputs and metrics
// ---------------------------------------------------------------------------

fs.writeFileSync(RAW_TEXT_PATH, rawText);
fs.writeFileSync(FIXED_TEXT_PATH, fixedText);

const finishReason = await result.finishReason;
const usage = await result.usage;

const summary = {
  pr: `jaylim/defi#${PR_NUMBER}`,
  duration_ms: Date.now() - startedAt,
  finish_reason: finishReason,
  usage,
  parts_total: partIdx,
  type_counts: typeCounts,
  text_delta_events: textDeltaCount,
  total_text_delta_chars: totalTextChars,
  raw_chars: rawText.length,
  fixed_chars: fixedText.length,
  segments_detected: segments.length,
  jumble_present: segments.length > 1
    ? `YES — provider concatenated ${segments.length} AgentMessage segments without separators. Compare assembled-text-raw.md vs assembled-text-fixed.md.`
    : 'No multi-segment concat detected (only one AgentMessage in this turn).',
};
fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));

console.log('\n========== SUMMARY ==========');
console.log(JSON.stringify(summary, null, 2));
console.log(`\nTrace:   ${TRACE_PATH}`);
console.log(`Raw:     ${RAW_TEXT_PATH}`);
console.log(`Fixed:   ${FIXED_TEXT_PATH}`);
console.log(`Summary: ${SUMMARY_PATH}`);

process.exit(0);
