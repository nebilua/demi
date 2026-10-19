import type { LlamaContext, RNLlamaOAICompatibleMessage } from 'llama.rn';
import { screenPrompt } from '@/lib/sharedScreenContext';

export type PromptMessage = RNLlamaOAICompatibleMessage;

// Count the actual template, role markers and generation prefix, not a
// characters/token estimate. Never truncate the user's current request.
export async function budgetPrompt(
  context: Pick<LlamaContext, 'getFormattedChat' | 'tokenize'>,
  system: string,
  turns: PromptMessage[],
  contextSize: number,
  optionalSystem?: string,
  sharedText?: string,
) {
  const outputTokens = Math.min(384, Math.max(64, Math.floor(contextSize / 4)));
  const limit = contextSize - outputTokens - 32;
  const current = turns.at(-1);
  if (!current) throw new Error('Write a message first.');
  const count = async (messages: PromptMessage[]) => {
    const formatted = await context.getFormattedChat(messages, null, { enable_thinking: false });
    return (await context.tokenize(formatted.prompt)).tokens.length;
  };
  const required: PromptMessage[] = [{ role: 'system', content: system }, current];
  if (await count(required) > limit) {
    throw new Error('This request is too long for the loaded model context. Shorten it or select a smaller section; your text has been kept.');
  }
  let messages = required;
  let sharedChars = 0;
  if (sharedText) {
    // The request itself is never shortened. Screen evidence is optional data,
    // bounded using the same native tokenizer as the final formatted prompt.
    let low = 0;
    let high = sharedText.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = [required[0], { role: 'user' as const, content: screenPrompt(String(current.content), { text: sharedText.slice(0, middle) }) }];
      if (await count(candidate) <= limit) low = middle; else high = middle - 1;
    }
    if (!low) throw new Error('Shared text does not fit this context. Shorten your request or share a smaller section.');
    sharedChars = low;
    messages = [required[0], { role: 'user', content: screenPrompt(String(current.content), { text: sharedText.slice(0, low) }) }];
  }
  // Prefer recent complete user/assistant pairs over optional personal data.
  for (let index = turns.length - 3; index >= 0; index -= 2) {
    const pair = turns.slice(index, index + 2);
    if (pair[0]?.role !== 'user' || pair[1]?.role !== 'assistant') break;
    const candidate = [messages[0], ...pair, ...messages.slice(1)];
    if (await count(candidate) > limit) break;
    messages = candidate;
  }
  if (optionalSystem && optionalSystem !== system) {
    const candidate = [{ role: 'system' as const, content: optionalSystem }, ...messages.slice(1)];
    if (await count(candidate) <= limit) messages = candidate;
  }
  const formatted = await context.getFormattedChat(messages, null, { enable_thinking: false });
  return { prompt: formatted.prompt, inputTokens: await count(messages), outputTokens, retainedTurns: messages.length - 1, sharedChars };
}
