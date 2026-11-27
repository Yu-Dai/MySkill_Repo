import { tool } from '#deps';

export type ToolRisk = 'read' | 'write';

export type ToolContext = {
  callId: string;
  sessionDir: string;
  workspaceDir: string;
  toolResultsDir: string;
  signal: AbortSignal;
};

export type AgentTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  risk: ToolRisk;
  execute: (input: any, context: ToolContext) => Promise<unknown>;
};

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function defineTool(definition: AgentTool): AgentTool {
  return definition;
}

export class ToolRegistry {
  #tools = new Map<string, AgentTool>();

  register(definition: AgentTool): void {
    if (!TOOL_NAME_PATTERN.test(definition.name)) {
      throw new Error(`工具名稱 ${JSON.stringify(definition.name)} 不合法，只能用英數字、底線、連字號，最長 64 字元`);
    }
    if (this.#tools.has(definition.name)) throw new Error(`工具名稱重複：${definition.name}`);
    this.#tools.set(definition.name, definition);
  }

  get(name: string): AgentTool | undefined {
    return this.#tools.get(name);
  }

  list(): AgentTool[] {
    return [...this.#tools.values()];
  }

  // 只把名稱、說明、參數格式交給模型，不交出 execute：
  // 這樣 SDK 不會自己執行工具，核准、紀錄、續跑都留在我們的迴圈裡。
  toModelTools(): Record<string, any> {
    const entries = this.list().map((t) => [
      t.name,
      tool({ description: t.description, inputSchema: t.inputSchema as any }),
    ]);
    return Object.fromEntries(entries);
  }
}
