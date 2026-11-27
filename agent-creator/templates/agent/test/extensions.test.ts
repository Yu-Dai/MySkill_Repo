import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { EventOf } from '../src/core/events.ts';
import { PathNotAllowedError, resolveAllowedPath } from '../src/core/tools/builtin.ts';
import { createHarness, waitFor } from './helpers/harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ECHO_MCP = join(here, 'fixtures', 'echo-mcp.mjs');

function makeSkillsDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'skills-test-'));
  mkdirSync(join(root, 'greeter'));
  writeFileSync(join(root, 'greeter', 'SKILL.md'), '---\nname: greeter\ndescription: 用固定格式打招呼\n---\n\n# Greeter\n\n照 `template.txt` 的格式回覆。\n');
  writeFileSync(join(root, 'greeter', 'template.txt'), '您好，{name}！');
  return root;
}

test('Skill：索引進入系統提示，load_skill 回傳本文，skill 資料夾內的檔案可讀', async () => {
  const skillsDir = makeSkillsDir();
  const h = await createHarness([
    { toolCalls: [{ id: 'c1', name: 'load_skill', arguments: { name: 'greeter' } }] },
    { toolCalls: [{ id: 'c2', name: 'read_file', arguments: { path: join(skillsDir, 'greeter', 'template.txt') } }] },
    { text: '您好，Sam！' },
  ], { skillsDirs: [skillsDir] });
  try {
    const runner = h.agent.createSession('打招呼');
    runner.sendMessage('打招呼');
    await runner.whenSettled();

    const system = h.fake.requests[0].body.messages[0].content;
    assert.match(system, /greeter：用固定格式打招呼/);
    assert.doesNotMatch(system, /template\.txt/);

    const results = runner.store.events.filter((e) => e.type === 'tool.result') as EventOf<'tool.result'>[];
    assert.equal(results[0].ok, true);
    assert.match(results[0].output, /# Greeter/);
    assert.match(results[0].output, /SKILL_DIR = /);
    assert.equal(results[1].output, '您好，{name}！');
  } finally {
    await h.cleanup();
    rmSync(skillsDir, { recursive: true, force: true });
  }
});

test('Skill：找不到名稱時回報可用清單', async () => {
  const skillsDir = makeSkillsDir();
  const h = await createHarness([
    { toolCalls: [{ name: 'load_skill', arguments: { name: 'nope' } }] },
    { text: 'x' },
  ], { skillsDirs: [skillsDir] });
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    const result = runner.store.events.find((e) => e.type === 'tool.result') as EventOf<'tool.result'>;
    assert.equal(result.ok, false);
    assert.match(result.output, /greeter/);
  } finally {
    await h.cleanup();
    rmSync(skillsDir, { recursive: true, force: true });
  }
});

test('路徑限制：workspace 外、.. 跳脫、符號連結跳脫都被擋下', () => {
  const root = mkdtempSync(join(tmpdir(), 'path-test-'));
  const workspace = join(root, 'workspace');
  const outside = join(root, 'outside');
  mkdirSync(workspace);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 's');
  assert.equal(resolveAllowedPath('a/b.txt', workspace, [workspace]).startsWith(workspace), true);
  assert.throws(() => resolveAllowedPath('../outside/secret.txt', workspace, [workspace]), PathNotAllowedError);
  assert.throws(() => resolveAllowedPath(join(outside, 'secret.txt'), workspace, [workspace]), PathNotAllowedError);
  try {
    symlinkSync(outside, join(workspace, 'link'));
    assert.throws(() => resolveAllowedPath('link/secret.txt', workspace, [workspace]), PathNotAllowedError);
  } catch (err) {
    // Windows 沒有開發人員模式時不能建立符號連結，這一段略過
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') throw err;
  }
  rmSync(root, { recursive: true, force: true });
});

test('寫檔到 workspace 外會失敗並回報給模型', async () => {
  const h = await createHarness([
    { toolCalls: [{ name: 'write_file', arguments: { path: '../escape.txt', content: 'x' } }] },
    { text: 'x' },
  ], { approval: { mode: 'never' } });
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    const result = runner.store.events.find((e) => e.type === 'tool.result') as EventOf<'tool.result'>;
    assert.equal(result.ok, false);
    assert.match(result.output, /不在允許的範圍/);
  } finally {
    await h.cleanup();
  }
});

test('run_command：在 workspace 執行並回傳 exit code 與輸出', async () => {
  const h = await createHarness([
    { toolCalls: [{ name: 'run_command', arguments: { command: 'node -e "console.log(6*7)"' } }] },
    { text: 'x' },
  ], { approval: { mode: 'never' } });
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    const result = runner.store.events.find((e) => e.type === 'tool.result') as EventOf<'tool.result'>;
    assert.match(result.output, /exit code: 0/);
    assert.match(result.output, /42/);
  } finally {
    await h.cleanup();
  }
});

test('run_command：中斷時連同子行程一起結束', async () => {
  const h = await createHarness([
    { toolCalls: [{ name: 'run_command', arguments: { command: 'node -e "setTimeout(()=>{}, 60000)"' } }] },
  ], { approval: { mode: 'never' } });
  try {
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await waitFor(() => runner.store.events.some((e) => e.type === 'tool.started'));
    const startedAt = Date.now();
    runner.interrupt();
    await runner.whenSettled();
    assert.ok(Date.now() - startedAt < 10_000);
    const result = runner.store.events.find((e) => e.type === 'tool.result') as EventOf<'tool.result'>;
    assert.match(result.output, /中斷/);
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'interrupted');
  } finally {
    await h.cleanup();
  }
});

test('MCP：stdio server 的工具以「server__tool」註冊，allow 的萬用字元可免核准', async () => {
  const h = await createHarness([
    { toolCalls: [{ name: 'demo__echo', arguments: { text: '哈囉' } }] },
    { text: 'x' },
  ], {
    mcpServers: { demo: { command: process.execPath, args: [ECHO_MCP] } },
    approval: { allow: ['demo__*'] },
  });
  try {
    assert.deepEqual(h.agent.mcpFailures, []);
    assert.ok(h.agent.registry.get('demo__echo'));
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    const result = runner.store.events.find((e) => e.type === 'tool.result') as EventOf<'tool.result'>;
    assert.equal(result.ok, true);
    assert.equal(result.output, 'echo: 哈囉');
    const sentTool = h.fake.requests[0].body.tools.find((t: any) => t.function.name === 'demo__echo');
    assert.deepEqual(sentTool.function.parameters.required, ['text']);
  } finally {
    await h.cleanup();
  }
});

test('MCP：連不上的 server 被記為失敗，agent 仍可運作', async () => {
  const h = await createHarness([{ text: '嗨' }], {
    mcpServers: { broken: { command: 'this-command-does-not-exist-xyz' } },
  });
  try {
    assert.equal(h.agent.mcpFailures.length, 1);
    assert.equal(h.agent.mcpFailures[0].server, 'broken');
    const runner = h.agent.createSession('x');
    runner.sendMessage('x');
    await runner.whenSettled();
    assert.equal((runner.store.events.at(-1) as EventOf<'turn.finished'>).reason, 'done');
  } finally {
    await h.cleanup();
  }
});
