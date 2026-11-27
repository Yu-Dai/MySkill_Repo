import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CorruptEventLogError, SessionBusyError, SessionStore } from '../src/core/store.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'store-test-'));
}

test('事件追加後能依序號讀回，重新開啟後序號接續', () => {
  const root = tempDir();
  const store = SessionStore.create(root, { title: 't', modelId: 'm' });
  store.append({ type: 'user.message', text: '哈囉' });
  store.append({ type: 'turn.started' });
  assert.deepEqual(store.events.map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual(store.eventsAfter(1).map((e) => e.type), ['user.message', 'turn.started']);

  const reopened = SessionStore.open(root, store.id);
  assert.ok(reopened);
  assert.equal(reopened.events.length, 3);
  assert.equal(reopened.append({ type: 'turn.finished', reason: 'done' }).seq, 4);
  rmSync(root, { recursive: true, force: true });
});

test('檔尾寫到一半的壞行會被截掉，下一筆事件不受影響', () => {
  const root = tempDir();
  const store = SessionStore.create(root, { title: 't', modelId: 'm' });
  store.append({ type: 'user.message', text: 'a' });
  const file = join(store.dir, 'events.jsonl');
  appendFileSync(file, '{"type":"user.message","text":"寫到一半');

  const reopened = SessionStore.open(root, store.id);
  assert.ok(reopened);
  assert.equal(reopened.events.length, 2);
  reopened.append({ type: 'user.message', text: 'b' });
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.doesNotThrow(() => lines.map((l) => JSON.parse(l)));
  rmSync(root, { recursive: true, force: true });
});

test('壞行不在檔尾時視為損毀並報錯', () => {
  const root = tempDir();
  const store = SessionStore.create(root, { title: 't', modelId: 'm' });
  const file = join(store.dir, 'events.jsonl');
  appendFileSync(file, 'not json\n');
  appendFileSync(file, `${JSON.stringify({ seq: 9, ts: 'x', type: 'turn.started' })}\n`);
  assert.throws(() => SessionStore.open(root, store.id), CorruptEventLogError);
  rmSync(root, { recursive: true, force: true });
});

test('執行鎖：同一個 session 不能被取得兩次，釋放後可以', () => {
  const root = tempDir();
  const store = SessionStore.create(root, { title: 't', modelId: 'm' });
  store.acquireLock();
  const other = SessionStore.open(root, store.id);
  assert.ok(other);
  assert.throws(() => other.acquireLock(), SessionBusyError);
  store.releaseLock();
  assert.doesNotThrow(() => other.acquireLock());
  other.releaseLock();
  rmSync(root, { recursive: true, force: true });
});

test('不合法的 session id 與不存在的 session 都回傳 null', () => {
  const root = tempDir();
  assert.equal(SessionStore.open(root, '../etc'), null);
  assert.equal(SessionStore.open(root, 'nope'), null);
  rmSync(root, { recursive: true, force: true });
});
