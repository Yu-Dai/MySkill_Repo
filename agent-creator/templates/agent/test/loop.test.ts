import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { EventOf } from '../src/core/events.ts';
import { TEST_API_KEY, collect, createHarness, types, waitFor } from './helpers/harness.ts';

test('完整一輪：模型呼叫工具、取得結果、再回覆文字', async () => {
  const h = await createHarness([
    { toolCalls: [{ name: 'list_dir', arguments: {} }] },
    { text: '資料夾是空的。' },
  ]);
  try {
    const runner = h.agent.createSession('列出檔案');
    const seen = collect(runner);
    runner.sendMessage('列出檔案');
    await runner.whenSettled();

    assert.deepEqual(types(runner.store.events), [
      'session.created', 'user.message', 'turn.started', 'assistant.message',
      'tool.started', 'tool.result', 'assistant.message', 'turn.finished',
    ]);
    const result = runner.store.events.find((e) => e.type === 'tool.result') as EventOf<'tool.result'>;
    assert.equal(result.ok, true);
    assert.equal(result.output, '(空資料夾)');
    const last = runner.store.events.at(-1) as EventOf<'turn.finished'>;
    assert.equal(last.reason, 'done');
    assert.equal(runner.status, 'idle');

    const deltas = seen.filter((e) => e.type === 'text.delta').map((e: any) => e.text).join('');
    assert.equal(deltas, '資料夾是空的。');
    const usage = (runner.store.events.find((e) => e.type === 'assistant.message') as EventOf<'assistant.message'>).usage;
    assert.deepEqual(usage, { inputTokens: 10, outputTokens: 5 });
  } finally {
    await h.cleanup();
  }
});

test('自訂 header 會送到模型端，第二次請求帶著工具結果', async () => {
  const h = await createHarness([
    { toolCalls: [{ id: 'call_a', name: 'list_dir', arguments: {} }] },
    { text: 'ok' },
  ]);
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();

    assert.equal(h.fake.requests.length, 2);
    assert.equal(h.fake.requests[0].headers['api-key'], TEST_API_KEY);
    const toolNames = h.fake.requests[0].body.tools.map((t: any) => t.function.name);
    assert.deepEqual(toolNames.sort(), ['list_dir', 'read_file', 'run_command', 'write_file']);
    const second = h.fake.requests[1].body.messages;
    const toolMessage = second.find((m: any) => m.role === 'tool');
    assert.equal(toolMessage.tool_call_id, 'call_a');
    assert.equal(second[0].role, 'system');
  } finally {
    await h.cleanup();
  }
});

test('寫入類工具要等核准；核准後才執行', async () => {
  const h = await createHarness([
    { toolCalls: [{ id: 'call_w', name: 'write_file', arguments: { path: 'a.txt', content: '內容' } }] },
    { text: '寫好了' },
  ]);
  try {
    const runner = h.agent.createSession('寫檔');
    runner.sendMessage('寫檔');
    await waitFor(() => runner.status === 'waiting_approval');
    assert.equal(existsSync(join(runner.store.workspaceDir, 'a.txt')), false);
    assert.equal(runner.store.readMeta().status, 'waiting_approval');

    assert.equal(runner.approve('call_w', 'allow'), true);
    await runner.whenSettled();
    assert.equal(readFileSync(join(runner.store.workspaceDir, 'a.txt'), 'utf8'), '內容');
    assert.ok(types(runner.store.events).includes('tool.approval_resolved'));
  } finally {
    await h.cleanup();
  }
});

test('拒絕核准時工具不執行，模型收到拒絕訊息', async () => {
  const h = await createHarness([
    { toolCalls: [{ id: 'call_w', name: 'write_file', arguments: { path: 'a.txt', content: 'x' } }] },
    { text: '好的，不寫' },
  ]);
  try {
    const runner = h.agent.createSession('寫檔');
    runner.sendMessage('寫檔');
    await waitFor(() => runner.status === 'waiting_approval');
    runner.approve('call_w', 'deny');
    await runner.whenSettled();

    assert.equal(existsSync(join(runner.store.workspaceDir, 'a.txt')), false);
    const result = runner.store.events.find((e) => e.type === 'tool.result') as EventOf<'tool.result'>;
    assert.equal(result.ok, false);
    assert.match(result.output, /拒絕/);
    assert.equal(types(runner.store.events).includes('tool.started'), false);
  } finally {
    await h.cleanup();
  }
});

test('approval.mode 為 never 時不詢問', async () => {
  const h = await createHarness([
    { toolCalls: [{ name: 'write_file', arguments: { path: 'a.txt', content: 'x' } }] },
    { text: 'done' },
  ], { approval: { mode: 'never' } });
  try {
    const runner = h.agent.createSession('寫檔');
    runner.sendMessage('寫檔');
    await runner.whenSettled();
    assert.equal(existsSync(join(runner.store.workspaceDir, 'a.txt')), true);
    assert.equal(types(runner.store.events).includes('tool.approval_requested'), false);
  } finally {
    await h.cleanup();
  }
});

test('不存在的工具與格式錯誤的參數都會回報給模型，不會讓迴圈當掉', async () => {
  const h = await createHarness([
    { toolCalls: [{ id: 'c1', name: 'no_such_tool', arguments: {} }] },
    { toolCalls: [{ id: 'c2', name: 'read_file', arguments: '{"path": 壞掉的 JSON' }] },
    { toolCalls: [{ id: 'c3', name: 'read_file', arguments: { wrong: 1 } }] },
    { text: '放棄' },
  ]);
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    const results = runner.store.events.filter((e) => e.type === 'tool.result') as EventOf<'tool.result'>[];
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.ok === false));
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'done');
    assert.equal(h.fake.requests.length, 4);
  } finally {
    await h.cleanup();
  }
});

test('超過步數上限時停止', async () => {
  const again = { toolCalls: [{ name: 'list_dir', arguments: {} }] };
  const h = await createHarness([again, again, again, again], { limits: { maxSteps: 2, modelRetries: 0 } });
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'max_steps');
    assert.equal(h.fake.requests.length, 2);
    assert.equal(runner.canResume, true);
  } finally {
    await h.cleanup();
  }
});

test('模型端回 500 時記錄錯誤事件並結束這一輪，之後可以續跑', async () => {
  const h = await createHarness([{ status: 500 }, { text: '恢復了' }]);
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    const error = runner.store.events.find((e) => e.type === 'error') as EventOf<'error'>;
    assert.ok(error);
    assert.ok(error.stack);
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'error');

    assert.equal(runner.canResume, true);
    runner.resume();
    await runner.whenSettled();
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'done');
  } finally {
    await h.cleanup();
  }
});

test('等待核准時中斷：這一輪以 interrupted 結束，續跑後重新詢問', async () => {
  const h = await createHarness([
    { toolCalls: [{ id: 'call_w', name: 'write_file', arguments: { path: 'a.txt', content: 'x' } }] },
    { text: '完成' },
  ]);
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await waitFor(() => runner.status === 'waiting_approval');
    assert.equal(runner.interrupt(), true);
    await runner.whenSettled();
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'interrupted');
    assert.equal(runner.status, 'idle');

    runner.resume();
    await waitFor(() => runner.status === 'waiting_approval');
    runner.approve('call_w', 'allow');
    await runner.whenSettled();
    assert.equal(existsSync(join(runner.store.workspaceDir, 'a.txt')), true);
    const requested = runner.store.events.filter((e) => e.type === 'tool.approval_requested');
    assert.equal(requested.length, 1);
  } finally {
    await h.cleanup();
  }
});

test('模型回應途中中斷：不留下半截訊息', async () => {
  const h = await createHarness([{ text: '慢慢來', delayMs: 300 }]);
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await waitFor(() => h.fake.requests.length === 1);
    runner.interrupt();
    await runner.whenSettled();
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'interrupted');
    assert.equal(types(runner.store.events).includes('assistant.message'), false);
  } finally {
    await h.cleanup();
  }
});

test('有未處理的工具呼叫時送新訊息：舊呼叫標為取消，對話繼續', async () => {
  const h = await createHarness([
    { toolCalls: [{ id: 'call_w', name: 'write_file', arguments: { path: 'a.txt', content: 'x' } }] },
    { text: '改做別的' },
  ]);
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await waitFor(() => runner.status === 'waiting_approval');
    runner.interrupt();
    await runner.whenSettled();

    runner.sendMessage('算了，改做別的');
    await runner.whenSettled();
    const cancelled = runner.store.events.find((e) => e.type === 'tool.result') as EventOf<'tool.result'>;
    assert.match(cancelled.output, /取消/);
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'done');
    const roles = h.fake.requests[1].body.messages.map((m: any) => m.role);
    assert.deepEqual(roles, ['system', 'user', 'assistant', 'tool', 'user']);
  } finally {
    await h.cleanup();
  }
});

test('執行中再送訊息會被拒絕', async () => {
  const h = await createHarness([{ text: '慢', delayMs: 200 }]);
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    assert.throws(() => runner.sendMessage('y'), { name: 'SessionRunningError' });
    await runner.whenSettled();
  } finally {
    await h.cleanup();
  }
});
