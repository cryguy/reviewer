import { Type } from '@mariozechner/pi-ai';
import { Agent, type AgentTool } from '@mariozechner/pi-agent-core';
import { createCodexResponsesModel } from './src/ai/providers.ts';
import { getCodexCredentials, getCodexApiKey } from './src/ai/codex-oauth.ts';

console.log('Getting Codex OAuth credentials...');
const credentials = await getCodexCredentials();
console.log('Authenticated successfully');

const model = createCodexResponsesModel(credentials, 'gpt-5.4');

console.log('Model created, running Agent with tools...');

const greetTool: AgentTool = {
  name: 'greet',
  label: 'Greet',
  description: 'Greet the user',
  parameters: Type.Object({
    message: Type.String({ description: 'Greeting message' }),
  }),
  execute: async (_toolCallId, params) => {
    const { message } = params as { message: string };
    console.log('[tool:greet] Called with:', { message });
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ success: true, message }) }],
      details: {},
    };
  },
};

try {
  let stepCount = 0;

  const agent = new Agent({
    initialState: {
      systemPrompt: 'You are a helpful assistant. Always use the greet tool to respond.',
      model,
      thinkingLevel: 'off',
      tools: [greetTool],
    },
    getApiKey: async () => getCodexApiKey(credentials),
    beforeToolCall: async () => {
      stepCount++;
      if (stepCount > 5) return { block: true, reason: 'Step limit reached' };
    },
  });

  agent.subscribe(async (event) => {
    if (event.type === 'turn_end') {
      console.log(`[step] Tool calls finished`);
    }
    if (event.type === 'tool_execution_end') {
      console.log(`[tool] ${event.toolName} completed`);
    }
  });

  await agent.prompt('Say hello');
  await agent.waitForIdle();

  // Extract final text
  const messages = agent.state.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as any;
    if (m.role === 'assistant') {
      const text = m.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');
      console.log('Result text:', text);
      break;
    }
  }

  console.log('Messages:', messages.length);
} catch (err) {
  console.error('Error:', err);
}

process.exit(0);
