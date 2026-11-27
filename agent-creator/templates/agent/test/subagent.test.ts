import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { EventOf, StreamEvent } from '../src/core/events.ts';
import { startServer } from '../src/server.ts';
import type { ScriptedReply } from './helpers/fake-openai.ts';
import { collect, createHarness, types, waitFor } from './helpers/harness.ts';

const SUBAGENT_MARKER = '你是被主 agent 派出來';

type Role = { isSubagent: boolean; brief: string; toolResults: number };

// 平行時請求到達的順序不固定，所以測試用的模型依「誰在問、問到第幾步」決定回覆，而不是照順序。
function roleOf(body: any): Role {
  const system = body.messages.find((m: any) => m.role === 'system')?.content ?? '';
  const firstUser = body.messages.find((m: any) => m.role === 'user')?.content ?? '';
  return {
    isSubagent: system.includes(SUBAGENT_MARKER),
    brief: firstUser,
    toolResults: body.messages.filter((m: any) => m.role === 'tool').length,
  };
}

const delegateCall = (id: string, goal: string, extra: object = {}) => ({ id, name: 'delegate', arguments: { goal, ...extra } });

function responder(main: (role: Role) => ScriptedReply, sub: (role: Role) => ScriptedReply) {
  return (body: any) => {
    const role = roleOf(body);
    return role.isSubagent ? sub(role) : main(role);
  };
}

test('交辦一個 subagent：主 agent 只收到報告，過程留在子 session 的紀錄', async () => {
  const h = await createHarness(responder(
    (role) => (role.toolResults === 0
      ? { toolCalls: [delegateCall('d1', '查出設定檔在哪', { context: '專案在 workspace' })] }
      : { text: '設定檔找到了' }),
    (role) => (role.toolResults === 0 ? { toolCalls: [{ id: 's1', name: 'list_dir', arguments: {} }] } : { text: '結論：在 config/ 底下' }),
  ));
  try {
    const runner = h.agent.createSession('x');
    const seen = collect(runner);
    runner.sendMessage('找設定檔');
    await runner.whenSettled();

    assert.deepEqual(types(runner.store.events), [
      'session.created', 'user.message', 'turn.started', 'assistant.message',
      'tool.started', 'subagent.started', 'subagent.finished', 'tool.result', 'assistant.message', 'turn.finished',
    ]);
    const result = runner.store.events.find((e) => e.type === 'tool.result') as EventOf<'tool.result'>;
    assert.equal(result.ok, true);
    assert.equal(result.output, '結論：在 config/ 底下');

    const started = runner.store.events.find((e) => e.type === 'subagent.started') as EventOf<'subagent.started'>;
    assert.equal(started.agentType, 'general');
    assert.equal(started.resumed, false);
    const finished = runner.store.events.find((e) => e.type === 'subagent.finished') as EventOf<'subagent.finished'>;
    assert.equal(finished.reason, 'done');
    assert.equal(finished.tokens, 30);

    const childLog = join(runner.store.dir, 'subagents', started.subagentId, 'events.jsonl');
    const childEvents = readFileSync(childLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(childEvents.map((e) => e.type), [
      'session.created', 'user.message', 'turn.started', 'assistant.message',
      'tool.started', 'tool.result', 'assistant.message', 'turn.finished',
    ]);
    assert.match(childEvents[1].text, /查出設定檔在哪/);
    assert.match(childEvents[1].text, /專案在 workspace/);
    assert.equal(existsSync(join(runner.store.dir, 'subagents', started.subagentId, 'workspace')), false);

    const forwarded = seen.filter((e): e is Extract<StreamEvent, { type: 'subagent.event' }> => e.type === 'subagent.event');
    assert.ok(forwarded.some((e) => e.event.type === 'tool.result'));
    assert.ok(forwarded.every((e) => e.subagentId === started.subagentId));
    assert.deepEqual(runner.subagentEvents(started.subagentId)?.map((e) => e.type), childEvents.map((e) => e.type));
    assert.equal(runner.subagentEvents('sub-nope'), null);

    const mainRequest = h.fake.requests.find((r) => !roleOf(r.body).isSubagent)!;
    const subRequest = h.fake.requests.find((r) => roleOf(r.body).isSubagent)!;
    const names = (r: typeof mainRequest) => r.body.tools.map((t: any) => t.function.name);
    assert.ok(names(mainRequest).includes('delegate'));
    assert.equal(names(subRequest).includes('delegate'), false);
    assert.match(mainRequest.body.messages[0].content, /交辦給 subagent/);
    assert.doesNotMatch(subRequest.body.messages[0].content, /交辦給 subagent/);
  } finally {
    await h.cleanup();
  }
});

test('同時交辦多個：受 maxParallel 限制，超過的排隊，結果全部交回', async () => {
  const DELAY_MS = 300;
  const h = await createHarness(responder(
    (role) => (role.toolResults === 0
      ? { toolCalls: [delegateCall('d1', '任務A'), delegateCall('d2', '任務B'), delegateCall('d3', '任務C')] }
      : { text: '三件都完成' }),
    (role) => ({ text: `完成 ${role.brief.match(/任務[ABC]/)![0]}`, delayMs: DELAY_MS }),
  ), { subagents: { maxParallel: 2 } });
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('做三件事');
    await runner.whenSettled();

    const results = runner.store.events.filter((e) => e.type === 'tool.result') as EventOf<'tool.result'>[];
    assert.deepEqual(results.map((r) => r.output).sort(), ['完成 任務A', '完成 任務B', '完成 任務C']);
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'done');

    const arrivals = h.fake.requests.filter((r) => roleOf(r.body).isSubagent).map((r) => r.at).sort((a, b) => a - b);
    assert.equal(arrivals.length, 3);
    assert.ok(arrivals[1] - arrivals[0] < DELAY_MS / 2, '前兩個應該同時開始');
    assert.ok(arrivals[2] - arrivals[0] >= DELAY_MS / 2, '第三個應該等前面有一個結束才開始');

    const finalRequest = h.fake.requests.at(-1)!.body.messages;
    assert.equal(finalRequest.filter((m: any) => m.role === 'tool').length, 3);
    const ids = runner.store.events.filter((e) => e.type === 'subagent.started').map((e) => (e as EventOf<'subagent.started'>).subagentId);
    assert.equal(new Set(ids).size, 3);
  } finally {
    await h.cleanup();
  }
});

test('subagent 的寫入需要核准時，詢問出現在主 session，核准後寫進共用的 workspace', async () => {
  const h = await createHarness(responder(
    (role) => (role.toolResults === 0 ? { toolCalls: [delegateCall('d1', '寫報告')] } : { text: '好了' }),
    (role) => (role.toolResults === 0
      ? { toolCalls: [{ id: 'w1', name: 'write_file', arguments: { path: 'report.md', content: '報告內容' } }] }
      : { text: '已寫入 report.md' }),
  ));
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await waitFor(() => runner.status === 'waiting_approval');
    const request = runner.store.events.find((e) => e.type === 'tool.approval_requested') as EventOf<'tool.approval_requested'>;
    assert.ok(request.subagentId);
    assert.equal(request.callId, `${request.subagentId}:w1`);
    assert.equal(request.name, 'write_file');
    assert.equal(runner.approve('w1', 'allow'), false);

    assert.equal(runner.approve(request.callId, 'allow'), true);
    await runner.whenSettled();
    assert.equal(readFileSync(join(runner.store.workspaceDir, 'report.md'), 'utf8'), '報告內容');
    const resolved = runner.store.events.find((e) => e.type === 'tool.approval_resolved') as EventOf<'tool.approval_resolved'>;
    assert.equal(resolved.subagentId, request.subagentId);
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'done');
  } finally {
    await h.cleanup();
  }
});

test('一輪交辦次數達到上限後，再交辦會被拒絕並告知模型', async () => {
  const h = await createHarness(responder(
    (role) => {
      if (role.toolResults === 0) return { toolCalls: [delegateCall('d1', '第一件')] };
      if (role.toolResults === 1) return { toolCalls: [delegateCall('d2', '第二件')] };
      return { text: '我自己做完剩下的' };
    },
    () => ({ text: '完成' }),
  ), { subagents: { maxPerTurn: 1 } });
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    const results = runner.store.events.filter((e) => e.type === 'tool.result') as EventOf<'tool.result'>[];
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
    assert.match(results[1].output, /達到上限/);
    assert.equal(runner.store.events.filter((e) => e.type === 'subagent.started').length, 1);
  } finally {
    await h.cleanup();
  }
});

test('subagent 執行途中中斷：不記結果，續跑後接續同一個子 session 並交回報告', async () => {
  let subCalls = 0;
  const h = await createHarness(responder(
    (role) => (role.toolResults === 0 ? { toolCalls: [delegateCall('d1', '慢慢查')] } : { text: '收到報告' }),
    () => {
      subCalls += 1;
      return subCalls === 1 ? { text: '還沒完', delayMs: 400 } : { text: '查完了' };
    },
  ));
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await waitFor(() => subCalls === 1);
    runner.interrupt();
    await runner.whenSettled();

    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'interrupted');
    assert.equal(types(runner.store.events).includes('tool.result'), false);
    assert.equal(runner.canResume, true);

    runner.resume();
    await runner.whenSettled();
    const starts = runner.store.events.filter((e) => e.type === 'subagent.started') as EventOf<'subagent.started'>[];
    assert.deepEqual(starts.map((s) => s.resumed), [false, true]);
    assert.equal(starts[0].subagentId, starts[1].subagentId);
    assert.equal(runner.store.events.filter((e) => e.type === 'tool.started').length, 1);
    const result = runner.store.events.find((e) => e.type === 'tool.result') as EventOf<'tool.result'>;
    assert.equal(result.output, '查完了');
    const child = runner.subagentEvents(starts[0].subagentId)!;
    assert.equal(child.filter((e) => e.type === 'turn.started').length, 2);
    assert.equal(child.filter((e) => e.type === 'user.message').length, 1);
  } finally {
    await h.cleanup();
  }
});

test('中斷後改送新訊息：未完成的交辦標為取消', async () => {
  let subCalls = 0;
  const h = await createHarness(responder(
    (role) => (role.toolResults === 0 ? { toolCalls: [delegateCall('d1', '慢慢查')] } : { text: '改做別的' }),
    () => { subCalls += 1; return { text: '慢', delayMs: 400 }; },
  ));
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await waitFor(() => subCalls === 1);
    runner.interrupt();
    await runner.whenSettled();
    runner.sendMessage('算了');
    await runner.whenSettled();
    const result = runner.store.events.find((e) => e.type === 'tool.result') as EventOf<'tool.result'>;
    assert.match(result.output, /取消/);
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'done');
  } finally {
    await h.cleanup();
  }
});

test('自訂類型：只拿得到列出的工具；不存在的類型會回報可用清單', async () => {
  const h = await createHarness(responder(
    (role) => {
      if (role.toolResults === 0) return { toolCalls: [delegateCall('d1', '查資料', { type: 'researcher' })] };
      if (role.toolResults === 1) return { toolCalls: [delegateCall('d2', '查資料', { type: 'nope' })] };
      return { text: 'ok' };
    },
    () => ({ text: '查到了' }),
  ), {
    subagents: { types: { researcher: { description: '只讀', systemPrompt: '你是研究員', tools: ['read_file', 'list_dir'] } } },
  });
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    const subRequest = h.fake.requests.find((r) => roleOf(r.body).isSubagent)!;
    assert.deepEqual(subRequest.body.tools.map((t: any) => t.function.name).sort(), ['list_dir', 'read_file']);
    assert.match(subRequest.body.messages[0].content, /你是研究員/);
    const results = runner.store.events.filter((e) => e.type === 'tool.result') as EventOf<'tool.result'>[];
    assert.equal(results[1].ok, false);
    assert.match(results[1].output, /researcher/);
    const mainTools = h.fake.requests[0].body.tools.find((t: any) => t.function.name === 'delegate');
    assert.match(mainTools.function.description, /researcher：只讀/);
  } finally {
    await h.cleanup();
  }
});

test('subagent 沒完成（達到步數上限）時，主 agent 收到失敗原因與它最後的進度', async () => {
  const h = await createHarness(responder(
    (role) => (role.toolResults === 0 ? { toolCalls: [delegateCall('d1', '無止盡')] } : { text: '知道了' }),
    () => ({ text: '還在找', toolCalls: [{ name: 'list_dir', arguments: {} }] }),
  ), { subagents: { maxSteps: 2 } });
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    const result = runner.store.events.find((e) => e.type === 'tool.result') as EventOf<'tool.result'>;
    assert.equal(result.ok, false);
    assert.match(result.output, /max_steps/);
    assert.match(result.output, /還在找/);
    const finished = runner.store.events.find((e) => e.type === 'subagent.finished') as EventOf<'subagent.finished'>;
    assert.equal(finished.reason, 'max_steps');
  } finally {
    await h.cleanup();
  }
});

test('subagent 用掉的 token 計入主 session 這一輪的預算', async () => {
  const h = await createHarness(responder(
    (role) => (role.toolResults === 0 ? { toolCalls: [delegateCall('d1', 'x')] } : { text: '不該走到這裡' }),
    () => ({ text: '完成' }),
  ), { limits: { maxTurnTokens: 25, modelRetries: 0 } });
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'token_budget');
  } finally {
    await h.cleanup();
  }
});

test('設定錯誤與關閉：類型列了不存在的工具會報錯；enabled 為 false 時沒有 delegate', async () => {
  await assert.rejects(
    createHarness([], { subagents: { types: { bad: { description: 'x', systemPrompt: 'x', tools: ['no_such'] } } } }),
    { name: 'ConfigError' },
  );
  const h = await createHarness([{ text: 'hi' }], { subagents: { enabled: false } });
  try {
    assert.equal(h.agent.registry.get('delegate'), undefined);
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    assert.doesNotMatch(h.fake.requests[0].body.messages[0].content, /交辦給 subagent/);
  } finally {
    await h.cleanup();
  }
});

test('HTTP：可以讀取子 session 的事件；不存在時回 404', async () => {
  const h = await createHarness(responder(
    (role) => (role.toolResults === 0 ? { toolCalls: [delegateCall('d1', '查')] } : { text: 'ok' }),
    () => ({ text: '報告' }),
  ));
  const server = await startServer(h.agent, { port: 0, token: 't' });
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    const started = runner.store.events.find((e) => e.type === 'subagent.started') as EventOf<'subagent.started'>;
    const get = (path: string) => fetch(`${server.url}${path}`, { headers: { authorization: 'Bearer t' } });

    const ok = await get(`/sessions/${runner.id}/subagents/${started.subagentId}/events`);
    assert.equal(ok.status, 200);
    const body = await ok.json() as { events: { type: string; seq: number }[] };
    assert.equal(body.events[0].type, 'session.created');
    const tail = await (await get(`/sessions/${runner.id}/subagents/${started.subagentId}/events?after=${body.events.length - 1}`)).json() as { events: unknown[] };
    assert.equal(tail.events.length, 1);
    assert.equal((await get(`/sessions/${runner.id}/subagents/sub-nope/events`)).status, 404);
    assert.equal((await get(`/sessions/${runner.id}/subagents/..%2F..%2Fx/events`)).status, 404);
  } finally {
    await server.close();
    await h.cleanup();
  }
});
