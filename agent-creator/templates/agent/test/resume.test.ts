import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { EventOf } from '../src/core/events.ts';
import { SessionStore } from '../src/core/store.ts';
import { createHarness, waitFor } from './helpers/harness.ts';

const NO_USAGE = { inputTokens: null, outputTokens: null };

// 直接寫出「行程在工具執行途中當掉」會留下的事件紀錄：有 turn.started 與 tool.started，沒有結果也沒有 turn.finished。
function crashedSession(sessionsDir: string, options: { toolStarted: boolean }): string {
  const store = SessionStore.create(sessionsDir, { title: 'crash', modelId: 'fake-model' });
  store.append({ type: 'user.message', text: '寫檔' });
  store.append({ type: 'turn.started' });
  store.append({
    type: 'assistant.message', text: '', finishReason: 'tool-calls', usage: NO_USAGE,
    toolCalls: [{ id: 'call_w', name: 'write_file', input: { path: 'a.txt', content: 'x' } }],
  });
  store.append({ type: 'tool.approval_requested', callId: 'call_w', name: 'write_file', input: {} });
  if (options.toolStarted) {
    store.append({ type: 'tool.approval_resolved', callId: 'call_w', decision: 'allow' });
    store.append({ type: 'tool.started', callId: 'call_w', name: 'write_file' });
  }
  return store.id;
}

test('工具執行途中當掉：續跑時不重跑工具，改回報結果未知', async () => {
  const h = await createHarness([{ text: '我先檢查檔案狀態' }]);
  try {
    const id = crashedSession(h.agent.config.sessionsDir, { toolStarted: true });
    const runner = h.agent.getSession(id);
    assert.ok(runner);
    assert.equal(runner.status, 'interrupted');
    assert.equal(runner.canResume, true);

    runner.resume();
    await runner.whenSettled();
    const result = runner.store.events.find((e) => e.type === 'tool.result') as EventOf<'tool.result'>;
    assert.equal(result.unknownOutcome, true);
    assert.equal(result.ok, false);
    assert.equal(existsSync(join(runner.store.workspaceDir, 'a.txt')), false);
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'done');
    assert.equal(runner.status, 'idle');
    const toolMessage = h.fake.requests[0].body.messages.find((m: any) => m.role === 'tool');
    assert.match(toolMessage.content, /結果未知/);
  } finally {
    await h.cleanup();
  }
});

test('等待核准時當掉：續跑後回到等待核准，不重複發出詢問事件，核准後照常執行', async () => {
  const h = await createHarness([{ text: '寫好了' }]);
  try {
    const id = crashedSession(h.agent.config.sessionsDir, { toolStarted: false });
    const runner = h.agent.getSession(id);
    assert.ok(runner);
    runner.resume();
    await waitFor(() => runner.status === 'waiting_approval');
    assert.equal(runner.store.events.filter((e) => e.type === 'tool.approval_requested').length, 1);

    runner.approve('call_w', 'allow');
    await runner.whenSettled();
    assert.equal(existsSync(join(runner.store.workspaceDir, 'a.txt')), true);
  } finally {
    await h.cleanup();
  }
});

test('沒有未完成的工作時，續跑會被拒絕', async () => {
  const h = await createHarness([{ text: '嗨' }]);
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    assert.equal(runner.canResume, false);
    assert.throws(() => runner.resume(), { name: 'NothingToResumeError' });
  } finally {
    await h.cleanup();
  }
});

test('訂閱時帶序號，只會重播該序號之後的事件', async () => {
  const h = await createHarness([{ text: '嗨' }]);
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    const replayed: number[] = [];
    runner.subscribe((event) => { if ('seq' in event) replayed.push(event.seq); }, 2);
    assert.deepEqual(replayed, runner.store.events.filter((e) => e.seq > 2).map((e) => e.seq));
  } finally {
    await h.cleanup();
  }
});
