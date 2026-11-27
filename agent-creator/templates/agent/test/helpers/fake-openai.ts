import { createServer } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export type ScriptedToolCall = { id?: string; name: string; arguments: unknown };

export type ScriptedReply = {
  text?: string;
  toolCalls?: ScriptedToolCall[];
  status?: number;
  delayMs?: number;
};

export type RecordedRequest = { headers: IncomingHttpHeaders; body: any };

export type FakeOpenAI = {
  baseURL: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
};

const OUT_OF_SCRIPT_TEXT = '(測試腳本已用完)';

function chunk(delta: object, finishReason: string | null = null): string {
  const payload = {
    id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: 0, model: 'fake',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function argumentsOf(call: ScriptedToolCall): string {
  return typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments);
}

// 模擬 OpenAI 相容的 /chat/completions，依序回覆預先寫好的腳本，並記下每次請求的 header 與 body。
export async function startFakeOpenAI(script: ScriptedReply[]): Promise<FakeOpenAI> {
  const requests: RecordedRequest[] = [];
  const remaining = [...script];

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (part) => { raw += part; });
    req.on('end', async () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ headers: req.headers, body });
      const reply = remaining.shift() ?? { text: OUT_OF_SCRIPT_TEXT };
      if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
      if (reply.status && reply.status >= 400) {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `fake error ${reply.status}` } }));
        return;
      }
      const calls = reply.toolCalls ?? [];
      const finishReason = calls.length > 0 ? 'tool_calls' : 'stop';
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

      if (body.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-fake', object: 'chat.completion', created: 0, model: 'fake', usage,
          choices: [{
            index: 0, finish_reason: finishReason,
            message: {
              role: 'assistant', content: reply.text ?? null,
              ...(calls.length > 0 ? {
                tool_calls: calls.map((c, i) => ({ id: c.id ?? `call_${i}`, type: 'function', function: { name: c.name, arguments: argumentsOf(c) } })),
              } : {}),
            },
          }],
        }));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(chunk({ role: 'assistant', content: '' }));
      if (reply.text) {
        const middle = Math.ceil(reply.text.length / 2);
        res.write(chunk({ content: reply.text.slice(0, middle) }));
        res.write(chunk({ content: reply.text.slice(middle) }));
      }
      calls.forEach((call, index) => {
        const args = argumentsOf(call);
        const middle = Math.ceil(args.length / 2);
        res.write(chunk({ tool_calls: [{ index, id: call.id ?? `call_${requests.length}_${index}`, type: 'function', function: { name: call.name, arguments: args.slice(0, middle) } }] }));
        res.write(chunk({ tool_calls: [{ index, function: { arguments: args.slice(middle) } }] }));
      });
      res.write(chunk({}, finishReason));
      res.write(`data: ${JSON.stringify({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: 0, model: 'fake', choices: [], usage })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
