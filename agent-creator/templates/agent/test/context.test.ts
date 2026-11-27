import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { z } from '#deps';
import { DEFAULT_CONTEXT_LIMITS } from '../src/core/config.ts';
import { buildMessages, pendingToolCalls, planCompaction } from '../src/core/context.ts';
import type { AgentEvent, EventBody, EventOf } from '../src/core/events.ts';
import { defineTool } from '../src/core/tools/registry.ts';
import { createHarness, types } from './helpers/harness.ts';

function sequence(bodies: EventBody[]): AgentEvent[] {
  return bodies.map((body, index) => ({ ...body, seq: index + 1, ts: '2026-01-01T00:00:00.000Z' }) as AgentEvent);
}

const call = (id: string) => ({ id, name: 'big', input: {} });
const result = (callId: string, output: string, outputPath?: string): EventBody => ({
  type: 'tool.result', callId, name: 'big', ok: true, output, durationMs: 1, ...(outputPath ? { outputPath } : {}),
});

const bigTool = (chars: number) => defineTool({
  name: 'big',
  description: '回傳一大段文字',
  risk: 'read',
  inputSchema: z.object({}),
  async execute() {
    return 'x'.repeat(chars);
  },
});

test('buildMessages：工具結果併入同一則 tool 訊息，並緊跟所屬的 assistant 訊息', () => {
  const events = sequence([
    { type: 'user.message', text: 'hi' },
    { type: 'assistant.message', text: '', toolCalls: [call('a'), call('b')], usage: { inputTokens: null, outputTokens: null }, finishReason: 'tool-calls' },
    result('a', 'A'),
    result('b', 'B'),
    { type: 'assistant.message', text: '完成', toolCalls: [], usage: { inputTokens: null, outputTokens: null }, finishReason: 'stop' },
  ]);
  const messages = buildMessages(events, { trimOldToolResults: false, keepRecentToolResults: 5 });
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'tool', 'assistant']);
  assert.equal((messages[2].content as any[]).length, 2);
});

test('buildMessages：開啟修剪時，較舊的工具輸出換成佔位字，並保留檔案路徑', () => {
  const events = sequence([
    { type: 'user.message', text: 'hi' },
    { type: 'assistant.message', text: '', toolCalls: [call('a')], usage: { inputTokens: null, outputTokens: null }, finishReason: 'tool-calls' },
    result('a', '舊輸出', '/tmp/a.txt'),
    { type: 'assistant.message', text: '', toolCalls: [call('b')], usage: { inputTokens: null, outputTokens: null }, finishReason: 'tool-calls' },
    result('b', '新輸出'),
  ]);
  const messages = buildMessages(events, { trimOldToolResults: true, keepRecentToolResults: 1 });
  const outputs = messages.filter((m) => m.role === 'tool').map((m) => (m.content as any[])[0].output.value);
  assert.match(outputs[0], /已省略/);
  assert.match(outputs[0], /\/tmp\/a\.txt/);
  assert.equal(outputs[1], '新輸出');
});

test('pendingToolCalls：只回傳最後一則 assistant 訊息中尚無結果的呼叫，並帶出核准與啟動狀態', () => {
  const events = sequence([
    { type: 'user.message', text: 'hi' },
    { type: 'assistant.message', text: '', toolCalls: [call('a'), call('b'), call('c')], usage: { inputTokens: null, outputTokens: null }, finishReason: 'tool-calls' },
    result('a', 'A'),
    { type: 'tool.approval_requested', callId: 'b', name: 'big', input: {} },
    { type: 'tool.approval_resolved', callId: 'b', decision: 'allow' },
    { type: 'tool.started', callId: 'b', name: 'big' },
  ]);
  const pending = pendingToolCalls(events);
  assert.deepEqual(pending.map((p) => p.call.id), ['b', 'c']);
  assert.deepEqual({ started: pending[0].started, decision: pending[0].decision }, { started: true, decision: 'allow' });
  assert.deepEqual({ started: pending[1].started, requested: pending[1].approvalRequested }, { started: false, requested: false });
});

test('planCompaction：訊息數不足時不壓縮；足夠時切點落在保留訊息之前', () => {
  const usage = { inputTokens: null, outputTokens: null };
  const events = sequence([
    { type: 'user.message', text: '第一件事' },
    { type: 'assistant.message', text: '', toolCalls: [call('a')], usage, finishReason: 'tool-calls' },
    result('a', 'A'),
    { type: 'assistant.message', text: '做完第一件', toolCalls: [], usage, finishReason: 'stop' },
    { type: 'user.message', text: '第二件事' },
  ]);
  assert.equal(planCompaction(events, { ...DEFAULT_CONTEXT_LIMITS, keepRecentMessages: 10 }), null);
  const plan = planCompaction(events, { ...DEFAULT_CONTEXT_LIMITS, keepRecentMessages: 2 });
  assert.ok(plan);
  assert.equal(plan.uptoSeq, 3);
  assert.match(plan.transcript, /第一件事/);
  assert.doesNotMatch(plan.transcript, /第二件事/);
});

test('過大的工具輸出寫到 tool-results，事件與送給模型的內容只留開頭與路徑', async () => {
  const h = await createHarness([
    { toolCalls: [{ id: 'call_big', name: 'big', arguments: {} }] },
    { text: 'ok' },
  ], { tools: [bigTool(20_000)] });
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    const event = runner.store.events.find((e) => e.type === 'tool.result') as EventOf<'tool.result'>;
    assert.ok(event.outputPath);
    assert.equal(readFileSync(event.outputPath, 'utf8').length, 20_000);
    assert.ok(event.output.length < 5_000);
    assert.match(event.output, /read_file/);
    const sent = h.fake.requests[1].body.messages.find((m: any) => m.role === 'tool').content;
    assert.ok(sent.length < 5_000);
  } finally {
    await h.cleanup();
  }
});

test('超過 context 上限時先摘要，摘要存成新事件，舊事件不變', async () => {
  const h = await createHarness([
    { toolCalls: [{ name: 'big', arguments: {} }] },
    { toolCalls: [{ name: 'big', arguments: {} }] },
    { text: '這是摘要' },
    { text: '全部完成' },
  ], {
    tools: [bigTool(3_000)],
    context: { maxContextTokens: 1_500, keepRecentToolResults: 10, keepRecentMessages: 2 },
  });
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('請開始');
    await runner.whenSettled();

    const compacted = runner.store.events.find((e) => e.type === 'context.compacted') as EventOf<'context.compacted'>;
    assert.ok(compacted);
    assert.equal(compacted.summary, '這是摘要');
    const before = runner.store.events.filter((e) => e.seq <= compacted.uptoSeq);
    assert.ok(types(before).includes('user.message'));

    const summaryRequest = h.fake.requests[2].body;
    assert.notEqual(summaryRequest.stream, true);
    const finalRequest = h.fake.requests[3].body.messages;
    assert.match(finalRequest[1].content, /較早對話的摘要/);
    assert.equal(finalRequest.some((m: any) => m.content === '請開始'), false);
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'done');
  } finally {
    await h.cleanup();
  }
});
