import { streamText, type LanguageModel, type LanguageModelUsage } from 'ai';

// ---------------------------------------------------------------------------
// Codex turn assembly with AgentMessage boundary preservation.
//
// The codex-app-server provider routes every AgentMessage item from a turn
// through emitTextDelta() with no separator, and they all share one text id.
// generateText / await result.text concatenate them with no whitespace, so
// narration messages end up glued to each other and to the final answer
// ("…installation access.# PR Review: Blocked"). We need the narration in the
// raw output, just with paragraph breaks where AgentMessage boundaries fell.
//
// Codex's stream interleaves text-deltas with tool-* events around each
// AgentMessage boundary. So whenever a text-delta arrives after any tool-*
// event since the last text-delta, that's a new AgentMessage — flush the
// current buffer as a segment and start a new one. Final output joins
// segments with a paragraph break.
// ---------------------------------------------------------------------------

export interface CodexStreamResult {
  text: string;
  usage: LanguageModelUsage;
  segments: number;
}

const TOOL_EVENT_TYPES = new Set([
  'tool-call',
  'tool-result',
  'tool-error',
  'tool-input-start',
  'tool-input-delta',
  'tool-input-end',
]);

export async function streamCodexText(
  model: LanguageModel,
  prompt: string,
  abortSignal: AbortSignal,
): Promise<CodexStreamResult> {
  const result = streamText({ model, prompt, abortSignal });

  const segments: string[] = [];
  let current = '';
  let sawToolSinceLastText = false;

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      if (sawToolSinceLastText && current) {
        segments.push(current);
        current = '';
      }
      current += part.text;
      sawToolSinceLastText = false;
    } else if (TOOL_EVENT_TYPES.has(part.type)) {
      sawToolSinceLastText = true;
    }
  }
  if (current) segments.push(current);

  return {
    text: segments.join('\n\n'),
    usage: await result.usage,
    segments: segments.length,
  };
}
