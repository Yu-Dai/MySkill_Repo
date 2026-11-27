import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateText, streamText } from '#deps';
import type { LanguageModel } from '#deps';
import type { ResolvedConfig } from './config.ts';
import {
  COMPACTION_INSTRUCTIONS, buildMessages, estimateTokens, lastConversationEvent, pendingToolCalls, planCompaction,
} from './context.ts';
import type { PendingCall } from './context.ts';
import type {
  AgentEvent, ApprovalDecision, EphemeralEvent, EventBody, EventOf, ToolCallRecord, TurnEndReason, Usage,
} from './events.ts';
import type { SessionStore } from './store.ts';
import { needsApproval } from './tools/approval.ts';
import type { SubagentRequest, ToolRegistry } from './tools/registry.ts';

const INLINE_HEAD_RATIO = 0.5;
const CHARS_PER_TOKEN_FALLBACK = 3;

export type LoopDeps = {
  config: ResolvedConfig;
  model: LanguageModel;
  registry: ToolRegistry;
  systemPrompt: string;
  store: SessionStore;
  emit: (body: EventBody) => AgentEvent;
  publish: (event: EphemeralEvent) => void;
  requestApproval: (call: ToolCallRecord, signal: AbortSignal) => Promise<ApprovalDecision>;
  signal: AbortSignal;
  runSubagent: ((request: SubagentRequest) => Promise<string>) | null;
  maxParallelTools: number;
};

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function eventsOfCurrentTurn(events: readonly AgentEvent[]): AgentEvent[] {
  const startedAt = events.findLastIndex((e) => e.type === 'turn.started');
  return startedAt === -1 ? [] : events.slice(startedAt);
}

function checkLimits(deps: LoopDeps): TurnEndReason | null {
  const { limits } = deps.config;
  const turn = eventsOfCurrentTurn(deps.store.events);
  const steps = turn.filter((e): e is EventOf<'assistant.message'> => e.type === 'assistant.message');
  if (steps.length >= limits.maxSteps) return 'max_steps';

  const started = turn[0];
  if (started && Date.now() - Date.parse(started.ts) >= limits.maxTurnMs) return 'timeout';

  const spent = steps.reduce((sum, step) => {
    const output = step.usage.outputTokens ?? Math.ceil(JSON.stringify(step).length / CHARS_PER_TOKEN_FALLBACK);
    return sum + (step.usage.inputTokens ?? 0) + output;
  }, 0);
  const delegated = turn.reduce((sum, e) => sum + (e.type === 'subagent.finished' ? e.tokens : 0), 0);
  if (spent + delegated >= limits.maxTurnTokens) return 'token_budget';
  return null;
}

function stringifyOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === undefined) return '(沒有輸出)';
  return JSON.stringify(output, null, 2);
}

function storeOutput(deps: LoopDeps, callKey: string, output: string): { output: string; outputPath?: string } {
  const limit = deps.config.context.maxInlineToolOutputChars;
  if (output.length <= limit) return { output };
  const outputPath = join(deps.store.toolResultsDir, `${callKey}.txt`);
  writeFileSync(outputPath, output);
  const head = output.slice(0, Math.floor(limit * INLINE_HEAD_RATIO));
  const note = `\n\n[輸出共 ${output.length} 字元，以上只是開頭。完整內容在 ${outputPath}，用 read_file 搭配 offset 分段讀取]`;
  return { output: head + note, outputPath };
}

function emitResult(deps: LoopDeps, pending: PendingCall, ok: boolean, output: string, startedAt: number, extra: { unknownOutcome?: true } = {}): void {
  const { call } = pending;
  const stored = storeOutput(deps, pending.callKey, output);
  deps.emit({
    type: 'tool.result', callId: call.id, name: call.name, ok, ...stored,
    durationMs: Date.now() - startedAt, ...extra,
  });
}

async function settleToolCall(deps: LoopDeps, pending: PendingCall): Promise<void> {
  const { call } = pending;
  const now = Date.now();
  const definition = deps.registry.get(call.name);
  const resuming = pending.started && definition?.resumable === true;

  // 上次執行到一半行程就結束了：工具可能做完也可能沒做，重跑有重複執行的風險，所以交給模型自己判斷。
  // 標示為可接續的工具例外，它們再執行一次會從原本的進度繼續。
  if (pending.started && !resuming) {
    emitResult(deps, pending, false, '執行中斷，結果未知。這個工具可能已經生效也可能沒有，請先檢查實際狀態再決定是否重做。', now, { unknownOutcome: true });
    return;
  }
  if (call.invalid) {
    emitResult(deps, pending, false, `工具參數格式錯誤：${call.invalid}。請依照工具的參數定義修正後再呼叫一次。`, now);
    return;
  }
  if (!definition) {
    const available = deps.registry.list().map((t) => t.name).join('、');
    emitResult(deps, pending, false, `沒有名為 ${call.name} 的工具。可用的工具：${available}`, now);
    return;
  }

  let decision = pending.decision;
  if (decision === null && needsApproval(definition, deps.config.approval)) {
    // 每次進入等待都發一筆新的詢問事件，前端只要認「turn.finished 之後舊的詢問全部失效」這一條規則。
    deps.emit({ type: 'tool.approval_requested', callId: call.id, name: call.name, input: call.input });
    try {
      decision = await deps.requestApproval(call, deps.signal);
    } catch (err) {
      if (isAbortError(err) || deps.signal.aborted) return;
      throw err;
    }
    deps.emit({ type: 'tool.approval_resolved', callId: call.id, decision });
  }
  if (decision === 'deny') {
    emitResult(deps, pending, false, '使用者拒絕執行這個工具。不要重試同一個操作，改用其他做法或詢問使用者。', now);
    return;
  }

  if (!resuming) deps.emit({ type: 'tool.started', callId: call.id, name: call.name });
  const startedAt = Date.now();
  try {
    const output = await definition.execute(call.input, {
      callId: call.id,
      callKey: pending.callKey,
      sessionDir: deps.store.dir,
      workspaceDir: deps.store.workspaceDir,
      toolResultsDir: deps.store.toolResultsDir,
      signal: deps.signal,
      runSubagent: async (request) => {
        if (!deps.runSubagent) throw new Error('這裡不能再交辦給 subagent。');
        return deps.runSubagent(request);
      },
    });
    emitResult(deps, pending, true, stringifyOutput(output), startedAt);
  } catch (err) {
    // 可接續的工具被中斷時不記結果，保持「已開始、未完成」，續跑時才能接著做。
    if (definition.resumable && deps.signal.aborted) return;
    emitResult(deps, pending, false, `工具執行失敗：${messageOf(err)}`, startedAt);
  }
}

async function settleConcurrently(deps: LoopDeps, calls: PendingCall[]): Promise<void> {
  const queue = [...calls];
  const worker = async () => {
    while (queue.length > 0 && !deps.signal.aborted) {
      await settleToolCall(deps, queue.shift() as PendingCall);
    }
  };
  const workers = Array.from({ length: Math.min(deps.maxParallelTools, queue.length) }, worker);
  const outcomes = await Promise.allSettled(workers);
  const failed = outcomes.find((o): o is PromiseRejectedResult => o.status === 'rejected');
  if (failed) throw failed.reason;
}

async function compactIfNeeded(deps: LoopDeps): Promise<void> {
  const { context } = deps.config;
  const full = buildMessages(deps.store.events, { trimOldToolResults: false, keepRecentToolResults: context.keepRecentToolResults });
  if (estimateTokens(deps.systemPrompt, full) <= context.maxContextTokens) return;
  const trimmed = buildMessages(deps.store.events, { trimOldToolResults: true, keepRecentToolResults: context.keepRecentToolResults });
  if (estimateTokens(deps.systemPrompt, trimmed) <= context.maxContextTokens) return;

  const plan = planCompaction(deps.store.events, context);
  if (!plan) return;
  const result = await generateText({
    model: deps.model,
    instructions: COMPACTION_INSTRUCTIONS,
    prompt: plan.transcript,
    abortSignal: deps.signal,
    maxRetries: deps.config.limits.modelRetries,
  });
  deps.emit({ type: 'context.compacted', summary: result.text, uptoSeq: plan.uptoSeq });
}

function contextForModel(deps: LoopDeps) {
  const { context } = deps.config;
  const full = buildMessages(deps.store.events, { trimOldToolResults: false, keepRecentToolResults: context.keepRecentToolResults });
  if (estimateTokens(deps.systemPrompt, full) <= context.maxContextTokens) return full;
  return buildMessages(deps.store.events, { trimOldToolResults: true, keepRecentToolResults: context.keepRecentToolResults });
}

function toUsage(usage: { inputTokens?: number; outputTokens?: number } | undefined): Usage {
  return { inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null };
}

async function callModel(deps: LoopDeps): Promise<void> {
  await compactIfNeeded(deps);

  const result = streamText({
    model: deps.model,
    instructions: deps.systemPrompt,
    messages: contextForModel(deps),
    tools: deps.registry.toModelTools(),
    abortSignal: deps.signal,
    maxRetries: deps.config.limits.modelRetries,
    // SDK 預設會把錯誤印到 console。core 不直接輸出，錯誤改由下方的 error 片段進入事件紀錄。
    onError: () => {},
  });

  let text = '';
  const toolCalls: ToolCallRecord[] = [];
  let usage: Usage = { inputTokens: null, outputTokens: null };
  let finishReason = 'unknown';

  for await (const part of result.fullStream as AsyncIterable<any>) {
    if (part.type === 'text-delta') {
      text += part.text;
      deps.publish({ type: 'text.delta', text: part.text });
    } else if (part.type === 'tool-call') {
      toolCalls.push({
        id: part.toolCallId,
        name: part.toolName,
        input: part.input,
        ...(part.invalid ? { invalid: messageOf(part.error) } : {}),
      });
    } else if (part.type === 'finish-step') {
      usage = toUsage(part.usage);
      finishReason = String(part.finishReason);
    } else if (part.type === 'abort') {
      return;
    } else if (part.type === 'error') {
      throw part.error;
    }
  }
  if (deps.signal.aborted) return;
  deps.emit({ type: 'assistant.message', text, toolCalls, usage, finishReason });
}

// 迴圈本身不記狀態：每一圈都從事件紀錄判斷「現在該做什麼」，所以中斷後重新進來會自然接續。
export async function runTurn(deps: LoopDeps): Promise<TurnEndReason> {
  while (true) {
    if (deps.signal.aborted) return 'interrupted';

    const pending = pendingToolCalls(deps.store.events);
    if (pending.length > 0) {
      // 有副作用的工具照順序一個一個做；彼此獨立的（例如交辦給 subagent）才同時進行。
      const isConcurrent = (p: PendingCall) => deps.registry.get(p.call.name)?.concurrent === true;
      for (const call of pending.filter((p) => !isConcurrent(p))) {
        if (deps.signal.aborted) return 'interrupted';
        await settleToolCall(deps, call);
      }
      await settleConcurrently(deps, pending.filter(isConcurrent));
      if (deps.signal.aborted) return 'interrupted';
      continue;
    }

    const last = lastConversationEvent(deps.store.events);
    if (last === null || last.type === 'assistant.message') return 'done';

    const limitReached = checkLimits(deps);
    if (limitReached) return limitReached;

    try {
      await callModel(deps);
    } catch (err) {
      if (deps.signal.aborted || isAbortError(err)) return 'interrupted';
      throw err;
    }
  }
}
