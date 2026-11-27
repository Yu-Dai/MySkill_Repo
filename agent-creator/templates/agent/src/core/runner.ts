import { lastConversationEvent, pendingToolCalls } from './context.ts';
import type { AgentEvent, ApprovalDecision, EphemeralEvent, EventBody, SessionStatus, StreamEvent, ToolCallRecord } from './events.ts';
import { runTurn } from './loop.ts';
import type { LoopDeps } from './loop.ts';
import type { SessionMeta, SessionStore } from './store.ts';

export type Listener = (event: StreamEvent) => void;

export type RunnerDeps = Pick<LoopDeps, 'config' | 'model' | 'registry'> & {
  systemPromptFor: (store: SessionStore) => string;
};

export class SessionRunningError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} 正在執行，請等這一輪結束或先中斷`);
    this.name = 'SessionRunningError';
  }
}

export class NothingToResumeError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} 沒有未完成的工作可以續跑`);
    this.name = 'NothingToResumeError';
  }
}

type ApprovalWaiter = { resolve: (decision: ApprovalDecision) => void; reject: (err: Error) => void };

function abortError(): Error {
  const err = new Error('已中斷');
  err.name = 'AbortError';
  return err;
}

export class SessionRunner {
  readonly store: SessionStore;
  #deps: RunnerDeps;
  #listeners = new Set<Listener>();
  #approvals = new Map<string, ApprovalWaiter>();
  #abort: AbortController | null = null;
  #turn: Promise<void> | null = null;

  constructor(store: SessionStore, deps: RunnerDeps) {
    this.store = store;
    this.#deps = deps;
  }

  get id(): string {
    return this.store.id;
  }

  get status(): SessionStatus {
    if (this.#turn) return this.#approvals.size > 0 ? 'waiting_approval' : 'running';
    if (this.store.lockOwnerPid() !== null) return 'running';
    const events = this.store.events;
    const lastStart = events.findLastIndex((e) => e.type === 'turn.started');
    const lastFinish = events.findLastIndex((e) => e.type === 'turn.finished');
    return lastStart > lastFinish ? 'interrupted' : 'idle';
  }

  get canResume(): boolean {
    if (this.status === 'running' || this.status === 'waiting_approval') return false;
    if (pendingToolCalls(this.store.events).length > 0) return true;
    const last = lastConversationEvent(this.store.events);
    return last !== null && last.type !== 'assistant.message';
  }

  describe(): SessionMeta & { canResume: boolean } {
    return { ...this.store.readMeta(), status: this.status, canResume: this.canResume };
  }

  // 重播與訂閱在同一個同步區段完成，中間不會漏掉事件。
  subscribe(listener: Listener, afterSeq = 0): () => void {
    for (const event of this.store.eventsAfter(afterSeq)) listener(event);
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  sendMessage(text: string): void {
    if (this.#turn || this.store.lockOwnerPid() !== null) throw new SessionRunningError(this.id);
    for (const pending of pendingToolCalls(this.store.events)) {
      this.#emit({
        type: 'tool.result', callId: pending.call.id, name: pending.call.name, ok: false,
        output: '未執行：使用者送出了新訊息，這個工具呼叫已取消。', durationMs: 0,
      });
    }
    this.#emit({ type: 'user.message', text });
    this.#startTurn();
  }

  resume(): void {
    if (this.#turn || this.store.lockOwnerPid() !== null) throw new SessionRunningError(this.id);
    if (!this.canResume) throw new NothingToResumeError(this.id);
    this.#startTurn();
  }

  approve(callId: string, decision: ApprovalDecision): boolean {
    const waiter = this.#approvals.get(callId);
    if (!waiter) return false;
    this.#approvals.delete(callId);
    waiter.resolve(decision);
    return true;
  }

  interrupt(): boolean {
    if (!this.#abort) return false;
    this.#abort.abort();
    for (const waiter of this.#approvals.values()) waiter.reject(abortError());
    this.#approvals.clear();
    return true;
  }

  async whenSettled(): Promise<void> {
    await this.#turn;
  }

  #emit(body: EventBody): AgentEvent {
    const event = this.store.append(body);
    this.#notify(event);
    return event;
  }

  #notify(event: StreamEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        this.#listeners.delete(listener);
      }
    }
  }

  #requestApproval(call: ToolCallRecord, signal: AbortSignal): Promise<ApprovalDecision> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      this.#approvals.set(call.id, { resolve, reject });
      this.#syncMeta();
    });
  }

  #syncMeta(): void {
    const lastFinish = this.store.events.findLast((e) => e.type === 'turn.finished');
    this.store.updateMeta({
      status: this.status,
      lastTurnEnd: lastFinish?.type === 'turn.finished' ? lastFinish.reason : null,
    });
  }

  #startTurn(): void {
    this.store.acquireLock();
    const abort = new AbortController();
    this.#abort = abort;
    this.#emit({ type: 'turn.started' });

    const run = async () => {
      let reason: Awaited<ReturnType<typeof runTurn>>;
      try {
        reason = await runTurn({
          config: this.#deps.config,
          model: this.#deps.model,
          registry: this.#deps.registry,
          systemPrompt: this.#deps.systemPromptFor(this.store),
          store: this.store,
          emit: (body) => this.#emit(body),
          publish: (event: EphemeralEvent) => this.#notify(event),
          requestApproval: (call, signal) => this.#requestApproval(call, signal),
          signal: abort.signal,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.#emit({ type: 'error', where: 'turn', message: error.message, stack: error.stack });
        reason = 'error';
      }
      this.#emit({ type: 'turn.finished', reason });
    };

    // 事件寫不進磁碟（例如磁碟滿了）時無法留下紀錄，只能即時告知還連著的前端。
    this.#turn = run()
      .catch((err) => this.#notify({ type: 'fatal', message: `無法寫入事件紀錄：${(err as Error).message}` }))
      .finally(() => {
        this.#abort = null;
        this.#turn = null;
        this.#approvals.clear();
        this.store.releaseLock();
        try {
          this.#syncMeta();
        } catch {
          // meta.json 只是列表用的快取，寫入失敗不影響事件紀錄這份真相來源
        }
      });
    this.#syncMeta();
  }
}
