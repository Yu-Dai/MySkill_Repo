import { tool } from '#deps';

export type ToolRisk = 'read' | 'write';

export type SubagentRequest = {
  callId: string;
  callKey: string;
  type: string;
  goal: string;
  context: string;
  expectedOutput: string;
};

export type ToolContext = {
  callId: string;
  callKey: string;
  sessionDir: string;
  workspaceDir: string;
  toolResultsDir: string;
  signal: AbortSignal;
  runSubagent: (request: SubagentRequest) => Promise<string>;
};

export type AgentTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  risk: ToolRisk;
  execute: (input: any, context: ToolContext) => Promise<unknown>;
  // concurrent：同一則回覆裡的多個呼叫可以同時執行。只適用於彼此獨立、沒有先後順序的工具。
  concurrent?: boolean;
  // resumable：執行到一半被中斷後，用同樣的參數再呼叫一次會接續而不是重做。
  resumable?: boolean;
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

  subset(keep: (definition: AgentTool) => boolean): ToolRegistry {
    const picked = new ToolRegistry();
    for (const definition of this.list()) if (keep(definition)) picked.register(definition);
    return picked;
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
