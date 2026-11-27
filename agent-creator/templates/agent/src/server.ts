import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono, cors, serve, streamSSE } from '#deps';
import type { Agent } from './core/agent.ts';
import { isPersisted } from './core/events.ts';
import type { ApprovalDecision, StreamEvent } from './core/events.ts';
import { NothingToResumeError, SessionRunningError } from './core/runner.ts';
import type { SessionRunner } from './core/runner.ts';

// 這個 server 能讓呼叫者執行指令，所以只接受本機連線。要給其他機器用，請在前面加一層自己的驗證與代理。
const LOOPBACK_HOST = '127.0.0.1';
const SSE_HEARTBEAT_MS = 15_000;
const TOKEN_BYTES = 24;
const BEARER_PREFIX = 'Bearer ';
const TEST_PAGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html');

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_CREATED = 201;
const HTTP_ACCEPTED = 202;

export type RunningServer = { url: string; token: string; close: () => Promise<void> };

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createApp(agent: Agent, token: string): Hono {
  const app = new Hono();

  if (agent.config.server.corsOrigins.length > 0) {
    app.use('*', cors({ origin: agent.config.server.corsOrigins }));
  }

  app.get('/', (c) => c.html(readFileSync(TEST_PAGE, 'utf8')));

  // EventSource 不能自訂 header，所以事件流也接受用 ?token= 帶 token。
  const requireToken = async (c: any, next: () => Promise<void>) => {
    const header = c.req.header('authorization') ?? '';
    const given = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : c.req.query('token') ?? '';
    if (!sameToken(given, token)) return c.json(errorBody('unauthorized', 'token 不正確或未提供'), HTTP_UNAUTHORIZED);
    await next();
  };
  app.use('/sessions', requireToken);
  app.use('/sessions/*', requireToken);

  const withSession = (id: string): SessionRunner | null => agent.getSession(id);
  const notFound = (id: string) => errorBody('session_not_found', `找不到 session ${id}`);

  app.get('/sessions', (c) => c.json({ sessions: agent.listSessions() }));

  app.post('/sessions', async (c) => {
    const body = await readJson(c.req.raw);
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message) return c.json(errorBody('invalid_request', '請在 message 欄位提供任務內容'), HTTP_BAD_REQUEST);
    const runner = agent.createSession(message);
    runner.sendMessage(message);
    return c.json(runner.describe(), HTTP_CREATED);
  });

  app.get('/sessions/:id', (c) => {
    const runner = withSession(c.req.param('id'));
    return runner ? c.json(runner.describe()) : c.json(notFound(c.req.param('id')), HTTP_NOT_FOUND);
  });

  app.get('/sessions/:id/events', (c) => {
    const runner = withSession(c.req.param('id'));
    if (!runner) return c.json(notFound(c.req.param('id')), HTTP_NOT_FOUND);
    const after = Number(c.req.query('after') ?? c.req.header('last-event-id') ?? 0);
    if (!Number.isInteger(after) || after < 0) {
      return c.json(errorBody('invalid_request', 'after 必須是非負整數'), HTTP_BAD_REQUEST);
    }

    return streamSSE(c, async (stream) => {
      let chain: Promise<void> = Promise.resolve();
      const enqueue = (message: { event: string; data: string; id?: string }) => {
        chain = chain.then(() => stream.writeSSE(message)).catch(() => {});
      };
      const forward = (event: StreamEvent) => enqueue({
        event: event.type,
        data: JSON.stringify(event),
        ...(isPersisted(event) ? { id: String(event.seq) } : {}),
      });
      const unsubscribe = runner.subscribe(forward, after);
      const heartbeat = setInterval(() => enqueue({ event: 'ping', data: '' }), SSE_HEARTBEAT_MS);
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.get('/sessions/:id/subagents/:subagentId/events', (c) => {
    const runner = withSession(c.req.param('id'));
    if (!runner) return c.json(notFound(c.req.param('id')), HTTP_NOT_FOUND);
    const after = Number(c.req.query('after') ?? 0);
    if (!Number.isInteger(after) || after < 0) {
      return c.json(errorBody('invalid_request', 'after 必須是非負整數'), HTTP_BAD_REQUEST);
    }
    const events = runner.subagentEvents(c.req.param('subagentId'), after);
    if (!events) return c.json(errorBody('subagent_not_found', `找不到 subagent ${c.req.param('subagentId')}`), HTTP_NOT_FOUND);
    return c.json({ events });
  });

  app.post('/sessions/:id/messages', async (c) => {
    const runner = withSession(c.req.param('id'));
    if (!runner) return c.json(notFound(c.req.param('id')), HTTP_NOT_FOUND);
    const body = await readJson(c.req.raw);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return c.json(errorBody('invalid_request', '請在 text 欄位提供訊息內容'), HTTP_BAD_REQUEST);
    try {
      runner.sendMessage(text);
    } catch (err) {
      if (err instanceof SessionRunningError) return c.json(errorBody('session_running', err.message), HTTP_CONFLICT);
      throw err;
    }
    return c.json(runner.describe(), HTTP_ACCEPTED);
  });

  app.post('/sessions/:id/approvals/:callId', async (c) => {
    const runner = withSession(c.req.param('id'));
    if (!runner) return c.json(notFound(c.req.param('id')), HTTP_NOT_FOUND);
    const body = await readJson(c.req.raw);
    const decision = body?.decision;
    if (decision !== 'allow' && decision !== 'deny') {
      return c.json(errorBody('invalid_request', 'decision 必須是 allow 或 deny'), HTTP_BAD_REQUEST);
    }
    if (!runner.approve(c.req.param('callId'), decision as ApprovalDecision)) {
      return c.json(errorBody('approval_not_pending', '這個工具呼叫目前沒有在等待核准'), HTTP_NOT_FOUND);
    }
    return c.json({ ok: true });
  });

  app.post('/sessions/:id/interrupt', (c) => {
    const runner = withSession(c.req.param('id'));
    if (!runner) return c.json(notFound(c.req.param('id')), HTTP_NOT_FOUND);
    return c.json({ interrupted: runner.interrupt() });
  });

  app.post('/sessions/:id/resume', (c) => {
    const runner = withSession(c.req.param('id'));
    if (!runner) return c.json(notFound(c.req.param('id')), HTTP_NOT_FOUND);
    try {
      runner.resume();
    } catch (err) {
      if (err instanceof SessionRunningError) return c.json(errorBody('session_running', err.message), HTTP_CONFLICT);
      if (err instanceof NothingToResumeError) return c.json(errorBody('nothing_to_resume', err.message), HTTP_CONFLICT);
      throw err;
    }
    return c.json(runner.describe(), HTTP_ACCEPTED);
  });

  return app;
}

export async function startServer(agent: Agent, options: { port: number; token?: string }): Promise<RunningServer> {
  const token = options.token || randomBytes(TOKEN_BYTES).toString('hex');
  const app = createApp(agent, token);
  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const created = serve({ fetch: app.fetch, port: options.port, hostname: LOOPBACK_HOST }, () => resolve(created));
    created.once('error', reject);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${LOOPBACK_HOST}:${port}`,
    token,
    close: () => new Promise((resolve) => {
      (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}
