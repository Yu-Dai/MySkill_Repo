import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.ts';
import type { RunningServer } from '../src/server.ts';
import { createHarness } from './helpers/harness.ts';
import type { Harness } from './helpers/harness.ts';
import type { ScriptedReply } from './helpers/fake-openai.ts';

const TOKEN = 'server-test-token';

type Ctx = { h: Harness; server: RunningServer; api: (path: string, init?: RequestInit) => Promise<Response> };

async function setup(script: ScriptedReply[]): Promise<Ctx> {
  const h = await createHarness(script);
  const server = await startServer(h.agent, { port: 0, token: TOKEN });
  const api = (path: string, init: RequestInit = {}) => fetch(`${server.url}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...init.headers },
  });
  return { h, server, api };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.server.close();
  await ctx.h.cleanup();
}

// 讀 SSE 直到 stopAt 回傳 true，回傳收到的 { event, id, data }。
async function readSse(response: Response, stopAt: (event: string, data: any) => boolean) {
  const received: { event: string; id: string | null; data: any }[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      const field = (name: string) => block.split('\n').find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1).trim() ?? null;
      const event = field('event') ?? 'message';
      const raw = field('data');
      const data = raw ? JSON.parse(raw) : null;
      received.push({ event, id: field('id'), data });
      if (stopAt(event, data)) {
        await reader.cancel();
        return received;
      }
    }
  }
  return received;
}

test('沒有 token 或 token 錯誤時回 401；測試頁不需要 token', async () => {
  const ctx = await setup([]);
  try {
    assert.equal((await fetch(`${ctx.server.url}/sessions`)).status, 401);
    assert.equal((await fetch(`${ctx.server.url}/sessions`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(`${ctx.server.url}/sessions/abc/events?token=wrong`)).status, 401);
    const page = await fetch(`${ctx.server.url}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  } finally {
    await teardown(ctx);
  }
});

test('開任務、用 SSE 收事件、送核准，整輪走完', async () => {
  const ctx = await setup([
    { toolCalls: [{ id: 'call_w', name: 'write_file', arguments: { path: 'a.txt', content: 'x' } }] },
    { text: '寫好了' },
  ]);
  try {
    const created = await ctx.api('/sessions', { method: 'POST', body: JSON.stringify({ message: '寫檔' }) });
    assert.equal(created.status, 201);
    const { id } = await created.json() as { id: string };

    const stream = await ctx.api(`/sessions/${id}/events`);
    assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
    const events = await readSse(stream, (event, data) => {
      if (event === 'tool.approval_requested') {
        void ctx.api(`/sessions/${id}/approvals/${data.callId}`, { method: 'POST', body: JSON.stringify({ decision: 'allow' }) });
      }
      return event === 'turn.finished';
    });

    const names = events.map((e) => e.event);
    assert.ok(names.includes('text.delta'));
    assert.equal(events.at(-1)!.data.reason, 'done');
    const persisted = events.filter((e) => e.id !== null);
    assert.deepEqual(persisted.map((e) => Number(e.id)), persisted.map((_, i) => i + 1));
    assert.equal(events.find((e) => e.event === 'text.delta')!.id, null);

    const meta = await (await ctx.api(`/sessions/${id}`)).json() as { status: string; canResume: boolean };
    assert.equal(meta.status, 'idle');
    assert.equal(meta.canResume, false);

    const replay = await ctx.api(`/sessions/${id}/events?after=${persisted.length - 1}`);
    const tail = await readSse(replay, (event) => event === 'turn.finished');
    assert.deepEqual(tail.map((e) => e.event), ['turn.finished']);

    const list = await (await ctx.api('/sessions')).json() as { sessions: { id: string }[] };
    assert.deepEqual(list.sessions.map((s) => s.id), [id]);
  } finally {
    await teardown(ctx);
  }
});

test('錯誤情境：找不到 session、欄位缺漏、執行中重複送訊息、沒有可續跑的工作', async () => {
  const ctx = await setup([{ text: '慢', delayMs: 300 }]);
  try {
    assert.equal((await ctx.api('/sessions/nope')).status, 404);
    assert.equal((await ctx.api('/sessions/..%2F..%2Fetc')).status, 404);
    assert.equal((await ctx.api('/sessions', { method: 'POST', body: '{}' })).status, 400);
    assert.equal((await ctx.api('/sessions', { method: 'POST', body: 'not json' })).status, 400);

    const created = await ctx.api('/sessions', { method: 'POST', body: JSON.stringify({ message: 'x' }) });
    const { id } = await created.json() as { id: string };
    const busy = await ctx.api(`/sessions/${id}/messages`, { method: 'POST', body: JSON.stringify({ text: 'y' }) });
    assert.equal(busy.status, 409);
    assert.equal((await busy.json() as any).error.code, 'session_running');
    assert.equal((await ctx.api(`/sessions/${id}/approvals/zzz`, { method: 'POST', body: JSON.stringify({ decision: 'allow' }) })).status, 404);
    assert.equal((await ctx.api(`/sessions/${id}/approvals/zzz`, { method: 'POST', body: JSON.stringify({ decision: 'maybe' }) })).status, 400);
    assert.equal((await ctx.api(`/sessions/${id}/events?after=abc`)).status, 400);

    const interrupted = await (await ctx.api(`/sessions/${id}/interrupt`, { method: 'POST' })).json() as { interrupted: boolean };
    assert.equal(interrupted.interrupted, true);
    await ctx.h.agent.getSession(id)!.whenSettled();
    const resumed = await ctx.api(`/sessions/${id}/resume`, { method: 'POST' });
    assert.equal(resumed.status, 202);
    await ctx.h.agent.getSession(id)!.whenSettled();
    assert.equal((await ctx.api(`/sessions/${id}/resume`, { method: 'POST' })).status, 409);
  } finally {
    await teardown(ctx);
  }
});
