import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync,
  truncateSync, writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { AgentEvent, EventBody, SessionStatus, TurnEndReason } from './events.ts';

const EVENTS_FILE = 'events.jsonl';
const META_FILE = 'meta.json';
const LOCK_FILE = 'run.lock';
const WORKSPACE_DIR = 'workspace';
const TOOL_RESULTS_DIR = 'tool-results';
const SUBAGENTS_DIR = 'subagents';
const NEWLINE_BYTE = 0x0a;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SESSION_ID_RANDOM_BYTES = 3;

export type SessionMeta = {
  id: string;
  title: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  lastTurnEnd: TurnEndReason | null;
};

export class SessionBusyError extends Error {
  constructor(sessionId: string, pid: number) {
    super(`session ${sessionId} 正由行程 ${pid} 執行中`);
    this.name = 'SessionBusyError';
  }
}

export class CorruptEventLogError extends Error {
  constructor(file: string, lineNumber: number) {
    super(`${file} 第 ${lineNumber} 行不是合法 JSON，且不在檔尾，無法自動修復`);
    this.name = 'CorruptEventLogError';
  }
}

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id);
}

function newSessionId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${randomBytes(SESSION_ID_RANDOM_BYTES).toString('hex')}`;
}

// 行程在寫入途中當掉會留下半行。讀取時略過它，並回報完好內容的結尾位置；
// 壞行若不在檔尾則視為真正的損毀。
function loadEvents(file: string): { events: AgentEvent[]; tornTailAt: number | null } {
  const raw = readFileSync(file);
  const events: AgentEvent[] = [];
  let start = 0;
  let goodEnd = 0;
  let lineNumber = 0;
  while (start < raw.length) {
    const newlineAt = raw.indexOf(NEWLINE_BYTE, start);
    if (newlineAt === -1) break;
    lineNumber += 1;
    const line = raw.subarray(start, newlineAt).toString('utf8').trim();
    if (line) {
      try {
        events.push(JSON.parse(line) as AgentEvent);
      } catch {
        if (newlineAt === raw.length - 1) break;
        throw new CorruptEventLogError(file, lineNumber);
      }
    }
    start = newlineAt + 1;
    goodEnd = start;
  }
  return { events, tornTailAt: goodEnd < raw.length ? goodEnd : null };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class SessionStore {
  readonly id: string;
  readonly dir: string;
  readonly workspaceDir: string;
  readonly toolResultsDir: string;
  #events: AgentEvent[];
  #tornTailAt: number | null;
  #holdsLock = false;

  private constructor(dir: string, id: string, loaded: { events: AgentEvent[]; tornTailAt: number | null }, workspaceDir?: string) {
    this.dir = dir;
    this.id = id;
    this.workspaceDir = workspaceDir ?? join(dir, WORKSPACE_DIR);
    this.toolResultsDir = join(dir, TOOL_RESULTS_DIR);
    this.#events = loaded.events;
    this.#tornTailAt = loaded.tornTailAt;
  }

  static #initialize(store: SessionStore, init: { title: string; modelId: string }): void {
    const now = new Date().toISOString();
    store.writeMeta({
      id: store.id, title: init.title, modelId: init.modelId,
      createdAt: now, updatedAt: now, status: 'idle', lastTurnEnd: null,
    });
    store.append({ type: 'session.created', title: init.title, modelId: init.modelId });
  }

  // 子 session 住在主 session 資料夾底下，有自己的事件紀錄，但和主 session 共用同一個 workspace。
  static createChild(parent: SessionStore, childId: string, init: { title: string; modelId: string }): SessionStore {
    const dir = join(parent.dir, SUBAGENTS_DIR, childId);
    mkdirSync(join(dir, TOOL_RESULTS_DIR), { recursive: true });
    writeFileSync(join(dir, EVENTS_FILE), '');
    const store = new SessionStore(dir, childId, { events: [], tornTailAt: null }, parent.workspaceDir);
    SessionStore.#initialize(store, init);
    return store;
  }

  static openChild(parent: SessionStore, childId: string): SessionStore | null {
    if (!isValidSessionId(childId)) return null;
    const dir = join(parent.dir, SUBAGENTS_DIR, childId);
    if (!existsSync(join(dir, EVENTS_FILE))) return null;
    return new SessionStore(dir, childId, loadEvents(join(dir, EVENTS_FILE)), parent.workspaceDir);
  }

  static create(sessionsDir: string, init: { title: string; modelId: string }): SessionStore {
    const now = new Date();
    const id = newSessionId(now);
    const dir = join(sessionsDir, id);
    mkdirSync(join(dir, WORKSPACE_DIR), { recursive: true });
    mkdirSync(join(dir, TOOL_RESULTS_DIR), { recursive: true });
    writeFileSync(join(dir, EVENTS_FILE), '');
    const store = new SessionStore(dir, id, { events: [], tornTailAt: null });
    SessionStore.#initialize(store, init);
    return store;
  }

  static open(sessionsDir: string, id: string): SessionStore | null {
    if (!isValidSessionId(id)) return null;
    const dir = join(sessionsDir, id);
    if (!existsSync(join(dir, EVENTS_FILE))) return null;
    return new SessionStore(dir, id, loadEvents(join(dir, EVENTS_FILE)));
  }

  static list(sessionsDir: string): SessionMeta[] {
    if (!existsSync(sessionsDir)) return [];
    const metas: SessionMeta[] = [];
    for (const entry of readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaFile = join(sessionsDir, entry.name, META_FILE);
      if (!existsSync(metaFile)) continue;
      try {
        metas.push(JSON.parse(readFileSync(metaFile, 'utf8')) as SessionMeta);
      } catch {
        continue;
      }
    }
    return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get events(): readonly AgentEvent[] {
    return this.#events;
  }

  eventsAfter(seq: number): AgentEvent[] {
    return this.#events.filter((e) => e.seq > seq);
  }

  append(body: EventBody): AgentEvent {
    const last = this.#events[this.#events.length - 1];
    const event = { ...body, seq: (last?.seq ?? 0) + 1, ts: new Date().toISOString() } as AgentEvent;
    const file = join(this.dir, EVENTS_FILE);
    // 只有要寫入的一方才截掉檔尾的半行；純讀取不改檔案，以免截到別的行程正在寫的內容。
    if (this.#tornTailAt !== null) {
      truncateSync(file, this.#tornTailAt);
      this.#tornTailAt = null;
    }
    appendFileSync(file, `${JSON.stringify(event)}\n`);
    this.#events.push(event);
    return event;
  }

  readMeta(): SessionMeta {
    return JSON.parse(readFileSync(join(this.dir, META_FILE), 'utf8')) as SessionMeta;
  }

  writeMeta(meta: SessionMeta): void {
    const target = join(this.dir, META_FILE);
    const temp = `${target}.tmp`;
    writeFileSync(temp, `${JSON.stringify(meta, null, 2)}\n`);
    renameSync(temp, target);
  }

  updateMeta(patch: Partial<SessionMeta>): SessionMeta {
    const meta = { ...this.readMeta(), ...patch, updatedAt: new Date().toISOString() };
    this.writeMeta(meta);
    return meta;
  }

  lockOwnerPid(): number | null {
    const lockFile = join(this.dir, LOCK_FILE);
    if (!existsSync(lockFile)) return null;
    const pid = Number(readFileSync(lockFile, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 && isProcessAlive(pid) ? pid : null;
  }

  acquireLock(): void {
    const lockFile = join(this.dir, LOCK_FILE);
    const owner = this.lockOwnerPid();
    if (owner !== null) throw new SessionBusyError(this.id, owner);
    rmSync(lockFile, { force: true });
    writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    this.#holdsLock = true;
  }

  releaseLock(): void {
    if (!this.#holdsLock) return;
    rmSync(join(this.dir, LOCK_FILE), { force: true });
    this.#holdsLock = false;
  }
}
