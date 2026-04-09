import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// Create the orchestrator provider — singleton, initialized once
export function createOrchestratorProvider(apiKey: string, model: string) {
  const nanogpt = createOpenAICompatible({
    name: 'nanogpt',
    baseURL: 'https://nano-gpt.com/api/v1',
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  return nanogpt(model);
}
