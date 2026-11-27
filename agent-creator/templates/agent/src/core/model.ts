import { createOpenAICompatible } from '#deps';
import type { LanguageModel } from '#deps';
import { ConfigError } from './config.ts';
import type { ModelConfig } from './config.ts';

const PROVIDER_NAME = 'custom';

function isModelConfig(model: ModelConfig | LanguageModel): model is ModelConfig {
  return typeof model === 'object' && model !== null && 'baseURL' in model;
}

export function modelIdOf(model: ModelConfig | LanguageModel): string {
  if (typeof model === 'string') return model;
  return model.modelId;
}

export function createModel(model: ModelConfig | LanguageModel): LanguageModel {
  if (!isModelConfig(model)) return model;
  if (!model.baseURL) throw new ConfigError('model.baseURL 是空的，請確認環境變數已設定');
  if (!model.modelId) throw new ConfigError('model.modelId 是空的，請確認環境變數已設定');
  const provider = createOpenAICompatible({
    name: PROVIDER_NAME,
    baseURL: model.baseURL,
    apiKey: model.apiKey,
    headers: model.headers,
    includeUsage: model.includeUsage ?? true,
  });
  return provider.chatModel(model.modelId);
}
