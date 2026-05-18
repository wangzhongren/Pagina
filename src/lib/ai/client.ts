import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/index';
import type { ChatMessage } from '../messaging';

const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

export type StreamCallback = (text: string) => void;

function toApiMessages(history: ChatMessage[]): MessageParam[] {
  return history.map((msg) => ({
    role: msg.role === 'user' ? 'user' : 'assistant',
    content: msg.content,
  }));
}

export async function sendMessage(params: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  systemPrompt: string;
  history: ChatMessage[];
  onText: StreamCallback;
  onComplete: (fullText: string) => void;
  onError: (err: Error) => void;
}): Promise<void> {
  const { apiKey, baseUrl, model, maxTokens, systemPrompt, history, onText, onComplete, onError } = params;

  const client = new Anthropic({
    apiKey,
    baseURL: baseUrl || DEFAULT_BASE_URL,
    dangerouslyAllowBrowser: true,
  });

  try {
    const stream = client.messages.stream({
      model: model || DEFAULT_MODEL,
      max_tokens: maxTokens || 32768,
      system: systemPrompt,
      messages: toApiMessages(history),
    });

    let fullText = '';

    stream.on('text', (raw) => {
      let delta: string;
      if (raw.startsWith(fullText)) {
        delta = raw.slice(fullText.length);
      } else {
        delta = raw;
      }
      if (!delta) return;
      fullText += delta;
      onText(delta);
    });

    await stream.finalMessage();
    onComplete(fullText);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}
