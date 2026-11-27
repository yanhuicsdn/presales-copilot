import { createDeepSeek } from '@ai-sdk/deepseek';

export function isDeepSeekConfigured(): boolean {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  return Boolean(key && key.length > 5 && !key.startsWith('sk-placeholder'));
}

export function getDeepSeekModelName(): string {
  return process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat';
}

export function createDeepSeekModel() {
  const provider = createDeepSeek({
    apiKey: process.env.DEEPSEEK_API_KEY?.trim() || 'offline-placeholder-key',
    baseURL: process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com',
  });
  return provider(getDeepSeekModelName());
}

export function getProviderMode(): 'deepseek' | 'deterministic' {
  return isDeepSeekConfigured() ? 'deepseek' : 'deterministic';
}
