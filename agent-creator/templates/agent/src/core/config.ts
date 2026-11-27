import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LanguageModel } from '#deps';
import type { AgentTool } from './tools/registry.ts';

export type ModelConfig = {
  baseURL: string;
  modelId: string;
  apiKey?: string;
  headers?: Record<string, string>;
  includeUsage?: boolean;
};

export type McpServerConfig =
  | { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { url: string; type?: 'http' | 'sse'; headers?: Record<string, string> };

export type ApprovalPolicy = {
  mode: 'ask' | 'never';
  allow: string[];
};

export type Limits = {
  maxSteps: number;
  maxTurnMs: number;
  maxTurnTokens: number;
  modelRetries: number;
  commandTimeoutMs: number;
};

export type ContextLimits = {
  maxContextTokens: number;
  keepRecentToolResults: number;
  keepRecentMessages: number;
  maxInlineToolOutputChars: number;
};

export type SubagentType = {
  description: string;
  systemPrompt: string;
  tools?: string[];
  model?: ModelConfig | LanguageModel;
  maxSteps?: number;
};

export type SubagentsConfig = {
  enabled: boolean;
  maxParallel: number;
  maxPerTurn: number;
  maxSteps: number;
  types: Record<string, SubagentType>;
};

export type ServerConfig = {
  port: number;
  corsOrigins: string[];
};

export type AgentConfig = {
  model: ModelConfig | LanguageModel;
  systemPrompt?: string;
  sessionsDir?: string;
  skillsDirs?: string[];
  tools?: AgentTool[];
  mcpServers?: Record<string, McpServerConfig>;
  approval?: Partial<ApprovalPolicy>;
  limits?: Partial<Limits>;
  context?: Partial<ContextLimits>;
  server?: Partial<ServerConfig>;
  subagents?: Partial<SubagentsConfig>;
};

export type ResolvedConfig = {
  model: ModelConfig | LanguageModel;
  systemPrompt: string;
  sessionsDir: string;
  skillsDirs: string[];
  tools: AgentTool[];
  mcpServers: Record<string, McpServerConfig>;
  approval: ApprovalPolicy;
  limits: Limits;
  context: ContextLimits;
  server: ServerConfig;
  subagents: SubagentsConfig;
};

const DEFAULT_SYSTEM_PROMPT = '你是一個能使用工具完成任務的助理。先想清楚步驟，需要時才呼叫工具，完成後用簡短文字回報結果。';
const DEFAULT_SESSIONS_DIR = './sessions';
const DEFAULT_SKILLS_DIR = './skills';

export const DEFAULT_LIMITS: Limits = {
  maxSteps: 30,
  maxTurnMs: 15 * 60 * 1000,
  maxTurnTokens: 400_000,
  modelRetries: 2,
  commandTimeoutMs: 120_000,
};

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  maxContextTokens: 60_000,
  keepRecentToolResults: 6,
  keepRecentMessages: 8,
  maxInlineToolOutputChars: 8_000,
};

export const DEFAULT_SERVER: ServerConfig = { port: 4317, corsOrigins: [] };

export const GENERAL_SUBAGENT = 'general';

const GENERAL_SUBAGENT_TYPE: SubagentType = {
  description: '通用型。可以使用所有工具，適合需要大量閱讀、搜尋或多步驟嘗試的獨立子任務。',
  systemPrompt: '你負責完成一項被交辦的子任務。專心把這一件事做完，不要擴大範圍。',
};

export const DEFAULT_SUBAGENTS: Omit<SubagentsConfig, 'types'> = {
  enabled: true,
  maxParallel: 3,
  maxPerTurn: 10,
  maxSteps: 20,
};

export function defineConfig(config: AgentConfig): AgentConfig {
  return config;
}

export function resolveConfig(config: AgentConfig, baseDir: string): ResolvedConfig {
  const fromBase = (p: string) => (isAbsolute(p) ? p : resolve(baseDir, p));
  return {
    model: config.model,
    systemPrompt: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    sessionsDir: fromBase(config.sessionsDir ?? DEFAULT_SESSIONS_DIR),
    skillsDirs: (config.skillsDirs ?? [DEFAULT_SKILLS_DIR]).map(fromBase),
    tools: config.tools ?? [],
    mcpServers: config.mcpServers ?? {},
    approval: { mode: config.approval?.mode ?? 'ask', allow: config.approval?.allow ?? [] },
    limits: { ...DEFAULT_LIMITS, ...config.limits },
    context: { ...DEFAULT_CONTEXT_LIMITS, ...config.context },
    server: { ...DEFAULT_SERVER, ...config.server },
    subagents: {
      ...DEFAULT_SUBAGENTS,
      ...config.subagents,
      types: { [GENERAL_SUBAGENT]: GENERAL_SUBAGENT_TYPE, ...config.subagents?.types },
    },
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export async function loadConfig(configPath: string): Promise<ResolvedConfig> {
  const absolute = resolve(configPath);
  let loaded: { default?: AgentConfig };
  try {
    loaded = await import(pathToFileURL(absolute).href);
  } catch (err) {
    throw new ConfigError(`讀取設定檔 ${absolute} 失敗：${(err as Error).message}`);
  }
  if (!loaded.default || typeof loaded.default !== 'object') {
    throw new ConfigError(`${absolute} 必須用 export default 匯出設定物件`);
  }
  if (!loaded.default.model) throw new ConfigError(`${absolute} 缺少 model 設定`);
  return resolveConfig(loaded.default, dirname(absolute));
}
