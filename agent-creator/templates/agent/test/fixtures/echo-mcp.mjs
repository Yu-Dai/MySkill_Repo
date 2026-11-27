// 測試用的最小 MCP server：stdio 上一行一個 JSON-RPC 訊息，只提供 echo 工具。
import { createInterface } from 'node:readline';

const METHOD_NOT_FOUND = -32601;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const reply = (result) => send({ jsonrpc: '2.0', id: request.id, result });

  if (request.method === 'initialize') {
    reply({
      protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'echo', version: '1.0.0' },
    });
  } else if (request.method === 'tools/list') {
    reply({
      tools: [{
        name: 'echo',
        description: '原樣回傳文字',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      }],
    });
  } else if (request.method === 'tools/call') {
    reply({ content: [{ type: 'text', text: `echo: ${request.params.arguments.text}` }] });
  } else {
    send({ jsonrpc: '2.0', id: request.id, error: { code: METHOD_NOT_FOUND, message: 'Method not found' } });
  }
});
