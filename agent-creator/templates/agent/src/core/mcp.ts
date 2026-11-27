import { createMCPClient, StdioMCPTransport } from '#deps';
import type { McpServerConfig } from './config.ts';
import type { AgentTool, ToolRegistry } from './tools/registry.ts';

const NAME_SEPARATOR = '__';

export type McpConnection = {
  failures: { server: string; message: string }[];
  close: () => Promise<void>;
};

function transportFor(server: McpServerConfig): unknown {
  if ('command' in server) {
    return new StdioMCPTransport({ command: server.command, args: server.args, env: server.env, cwd: server.cwd });
  }
  return { type: server.type ?? 'http', url: server.url, headers: server.headers };
}

function textOfResult(result: unknown): { text: string; isError: boolean } {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) return { text: JSON.stringify(result, null, 2), isError: false };
  const text = content
    .map((part: { type?: string; text?: string }) => (part.type === 'text' ? part.text ?? '' : `[${part.type ?? '未知'} 內容，未顯示]`))
    .join('\n');
  return { text, isError: (result as { isError?: boolean }).isError === true };
}

// 單一 MCP server 連不上不該讓整個 agent 起不來，所以失敗會被收集起來回報，其餘 server 照常註冊。
export async function connectMcpServers(
  servers: Record<string, McpServerConfig>,
  registry: ToolRegistry,
): Promise<McpConnection> {
  const clients: { close: () => Promise<void> }[] = [];
  const failures: McpConnection['failures'] = [];

  for (const [serverName, server] of Object.entries(servers)) {
    try {
      const client = await createMCPClient({ transport: transportFor(server) as any });
      clients.push(client);
      const tools = (await client.tools()) as Record<string, any>;
      for (const [toolName, remote] of Object.entries(tools)) {
        const definition: AgentTool = {
          name: `${serverName}${NAME_SEPARATOR}${toolName}`,
          description: remote.description ?? '',
          inputSchema: remote.inputSchema,
          risk: 'write',
          async execute(input, ctx) {
            const result = await remote.execute(input, { toolCallId: ctx.callId, messages: [], abortSignal: ctx.signal });
            const { text, isError } = textOfResult(result);
            if (isError) throw new Error(text);
            return text;
          },
        };
        registry.register(definition);
      }
    } catch (err) {
      failures.push({ server: serverName, message: (err as Error).message });
    }
  }

  return {
    failures,
    async close() {
      await Promise.allSettled(clients.map((client) => client.close()));
    },
  };
}
