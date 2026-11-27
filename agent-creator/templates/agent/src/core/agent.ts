import { mkdirSync } from 'node:fs';
import type { LanguageModel } from '#deps';
import { ConfigError } from './config.ts';
import type { ResolvedConfig } from './config.ts';
import { connectMcpServers } from './mcp.ts';
import type { McpConnection } from './mcp.ts';
import { createModel, modelIdOf } from './model.ts';
import { SessionRunner } from './runner.ts';
import { LOAD_SKILL_TOOL_NAME, createLoadSkillTool, loadSkillIndex, renderSkillIndex } from './skills.ts';
import type { SkillEntry } from './skills.ts';
import { SessionStore } from './store.ts';
import type { SessionMeta } from './store.ts';
import { DELEGATE_TOOL_NAME, SUBAGENT_RULES, createDelegateTool, delegationGuide } from './subagents.ts';
import type { ResolvedSubagentType, SubagentHost } from './subagents.ts';
import { createBuiltinTools } from './tools/builtin.ts';
import { ToolRegistry } from './tools/registry.ts';

const TITLE_MAX_CHARS = 60;

function environmentSection(store: SessionStore): string {
  const shell = process.platform === 'win32' ? 'PowerShell' : 'sh';
  return [
    '## 執行環境',
    `- 作業系統：${process.platform}，run_command 使用 ${shell}`,
    `- workspace：${store.workspaceDir}`,
    '- 檔案工具的相對路徑以 workspace 為基準，寫檔只能寫在 workspace 內。',
  ].join('\n');
}

function composePrompt(parts: string[]): string {
  return parts.filter(Boolean).join('\n\n');
}

function resolveSubagents(config: ResolvedConfig, mainModel: LanguageModel, registry: ToolRegistry, skills: SkillEntry[]): SubagentHost {
  const types = new Map<string, ResolvedSubagentType>();
  for (const [name, definition] of Object.entries(config.subagents.types)) {
    for (const toolName of definition.tools ?? []) {
      if (!registry.get(toolName)) throw new ConfigError(`subagent 類型 ${name} 的 tools 列了不存在的工具：${toolName}`);
      if (toolName === DELEGATE_TOOL_NAME) throw new ConfigError(`subagent 類型 ${name} 不能使用 ${DELEGATE_TOOL_NAME}：subagent 不能再交辦`);
    }
    const allowed = definition.tools ? new Set(definition.tools) : null;
    const childRegistry = registry.subset((t) => t.name !== DELEGATE_TOOL_NAME && (allowed === null || allowed.has(t.name)));
    const canLoadSkills = childRegistry.get(LOAD_SKILL_TOOL_NAME) !== undefined;
    types.set(name, {
      name,
      description: definition.description,
      model: definition.model ? createModel(definition.model) : mainModel,
      registry: childRegistry,
      maxSteps: definition.maxSteps ?? config.subagents.maxSteps,
      promptFor: (store) => composePrompt([
        definition.systemPrompt, SUBAGENT_RULES, environmentSection(store), canLoadSkills ? renderSkillIndex(skills) : '',
      ]),
    });
  }
  return { config: config.subagents, types };
}

export class Agent {
  readonly config: ResolvedConfig;
  readonly model: LanguageModel;
  readonly registry: ToolRegistry;
  readonly skills: SkillEntry[];
  readonly mcpFailures: McpConnection['failures'];
  #mcp: McpConnection;
  #subagents: SubagentHost | null;
  #runners = new Map<string, SessionRunner>();

  private constructor(config: ResolvedConfig, model: LanguageModel, registry: ToolRegistry, skills: SkillEntry[], mcp: McpConnection, subagents: SubagentHost | null) {
    this.config = config;
    this.model = model;
    this.registry = registry;
    this.skills = skills;
    this.#mcp = mcp;
    this.#subagents = subagents;
    this.mcpFailures = mcp.failures;
  }

  static async create(config: ResolvedConfig): Promise<Agent> {
    mkdirSync(config.sessionsDir, { recursive: true });
    const model = createModel(config.model);
    const skills = loadSkillIndex(config.skillsDirs);
    const registry = new ToolRegistry();
    const builtin = createBuiltinTools({
      readableRoots: config.skillsDirs,
      commandTimeoutMs: config.limits.commandTimeoutMs,
    });
    for (const definition of builtin) registry.register(definition);
    if (skills.length > 0) registry.register(createLoadSkillTool(skills));
    for (const definition of config.tools) registry.register(definition);
    const mcp = await connectMcpServers(config.mcpServers, registry);

    let subagents: SubagentHost | null = null;
    if (config.subagents.enabled) {
      try {
        subagents = resolveSubagents(config, model, registry, skills);
      } catch (err) {
        await mcp.close();
        throw err;
      }
      registry.register(createDelegateTool(subagents.types, config.subagents));
    }
    return new Agent(config, model, registry, skills, mcp, subagents);
  }

  systemPromptFor(store: SessionStore): string {
    return composePrompt([
      this.config.systemPrompt,
      environmentSection(store),
      renderSkillIndex(this.skills),
      this.#subagents ? delegationGuide(this.config.subagents) : '',
    ]);
  }

  #runnerFor(store: SessionStore): SessionRunner {
    const runner = new SessionRunner(store, {
      config: this.config,
      model: this.model,
      registry: this.registry,
      systemPromptFor: (s) => this.systemPromptFor(s),
      subagents: this.#subagents,
    });
    this.#runners.set(store.id, runner);
    return runner;
  }

  createSession(firstMessage: string): SessionRunner {
    const title = firstMessage.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_CHARS);
    const store = SessionStore.create(this.config.sessionsDir, { title, modelId: modelIdOf(this.config.model) });
    return this.#runnerFor(store);
  }

  getSession(id: string): SessionRunner | null {
    const cached = this.#runners.get(id);
    if (cached) return cached;
    const store = SessionStore.open(this.config.sessionsDir, id);
    return store ? this.#runnerFor(store) : null;
  }

  listSessions(): SessionMeta[] {
    // meta.json 的狀態可能是行程當掉前留下的，所以一律以 runner 依事件紀錄與執行鎖算出的狀態為準。
    return SessionStore.list(this.config.sessionsDir).map((meta) => {
      const runner = this.getSession(meta.id);
      return runner ? { ...meta, status: runner.status } : meta;
    });
  }

  async close(): Promise<void> {
    for (const runner of this.#runners.values()) runner.interrupt();
    await Promise.allSettled([...this.#runners.values()].map((runner) => runner.whenSettled()));
    await this.#mcp.close();
  }
}
