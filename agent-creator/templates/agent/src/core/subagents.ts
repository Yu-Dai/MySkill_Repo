import { z } from '#deps';
import type { LanguageModel } from '#deps';
import { GENERAL_SUBAGENT } from './config.ts';
import type { SubagentsConfig } from './config.ts';
import { lastConversationEvent, pendingToolCalls } from './context.ts';
import type { AgentEvent, EventOf, TurnEndReason } from './events.ts';
import { runTurn } from './loop.ts';
import type { LoopDeps } from './loop.ts';
import { SessionStore } from './store.ts';
import { defineTool } from './tools/registry.ts';
import type { AgentTool, SubagentRequest, ToolRegistry } from './tools/registry.ts';

export const DELEGATE_TOOL_NAME = 'delegate';
const SUBAGENT_ID_PREFIX = 'sub-';
const APPROVAL_ID_SEPARATOR = ':';
const GOAL_PREVIEW_CHARS = 80;
const NO_REPORT_TEXT = '(subagent 沒有留下任何回報內容)';

export const SUBAGENT_RULES = [
  '## 你的處境',
  '你是被主 agent 派出來處理一項子任務的 subagent。',
  '- 你看不到主 agent 先前的對話，任務說明就是你知道的全部。資訊不足時依合理判斷進行，並在回報中寫明你做了哪些假設。',
  '- 你不能向使用者提問，也不能再把工作派給別人。',
  '- 主 agent 只會看到你最後一則回覆，看不到你中間做了什麼。',
  '',
  '## 最後一則回覆的格式',
  '完成後用一則回覆交代，依序包含：',
  '1. 結論：直接回答任務要的東西。',
  '2. 依據：結論來自哪些檔案或工具結果，寫出檔案路徑。',
  '3. 未確認：沒有查到、沒有驗證或不確定的部分。沒有就寫「無」。',
  '4. 產出的檔案：你建立或修改了哪些檔案。沒有就寫「無」。',
  '內容很長時，把完整內容用 write_file 寫成檔案，回覆裡只放摘要和檔案路徑。',
].join('\n');

export type ResolvedSubagentType = {
  name: string;
  description: string;
  model: LanguageModel;
  registry: ToolRegistry;
  maxSteps: number;
  promptFor: (store: SessionStore) => string;
};

export type SubagentHost = {
  config: SubagentsConfig;
  types: Map<string, ResolvedSubagentType>;
};

export function createDelegateTool(types: Map<string, ResolvedSubagentType>, config: SubagentsConfig): AgentTool {
  const typeList = [...types.values()].map((t) => `- ${t.name}：${t.description}`).join('\n');
  return defineTool({
    name: DELEGATE_TOOL_NAME,
    description: [
      '把一項獨立的子任務交給 subagent 處理。subagent 有自己的上下文，做完只回傳一份報告，過程不會佔用你的上下文。',
      `同一則回覆裡可以呼叫多次，最多同時進行 ${config.maxParallel} 個。`,
      'subagent 看不到目前的對話，所以 goal 和 context 必須寫到「沒看過這段對話的人也能照做」。',
      '可用的類型：',
      typeList,
    ].join('\n'),
    risk: 'read',
    concurrent: true,
    resumable: true,
    inputSchema: z.object({
      goal: z.string().describe('要 subagent 完成什麼。寫出明確的完成條件。'),
      context: z.string().optional().describe('subagent 需要知道的背景：相關檔案路徑、已知的事實、限制、已經試過什麼。'),
      expectedOutput: z.string().optional().describe('希望回報包含什麼、用什麼格式。'),
      type: z.string().optional().describe(`subagent 類型，預設 ${GENERAL_SUBAGENT}`),
    }),
    async execute(input: { goal: string; context?: string; expectedOutput?: string; type?: string }, ctx) {
      return ctx.runSubagent({
        callId: ctx.callId,
        callKey: ctx.callKey,
        type: input.type ?? GENERAL_SUBAGENT,
        goal: input.goal,
        context: input.context ?? '',
        expectedOutput: input.expectedOutput ?? '',
      });
    },
  });
}

export function delegationGuide(config: SubagentsConfig): string {
  return [
    '## 交辦給 subagent',
    `你可以用 ${DELEGATE_TOOL_NAME} 工具把子任務交給 subagent。它在自己的上下文裡工作，只把結論交回來。`,
    '適合交辦：需要讀很多檔案或嘗試很多步才能得到一個結論的工作；彼此獨立、可以分頭進行的幾件事。',
    '不適合交辦：一兩步就能完成的事；需要你目前對話脈絡才能判斷的事。',
    `同時進行的 subagent 之間不要負責同一個檔案。一輪最多交辦 ${config.maxPerTurn} 次，請把額度用在真正需要的地方。`,
    '收到報告後由你負責判斷與整合，報告中標為「未確認」的部分不要當成事實。',
  ].join('\n');
}

function briefOf(request: SubagentRequest): string {
  return [
    '## 目標', request.goal, '',
    '## 已知資訊', request.context || '（主 agent 沒有提供）', '',
    '## 期望的回報內容', request.expectedOutput || '（未指定，照你的回覆格式規定）',
  ].join('\n');
}

function lastReport(events: readonly AgentEvent[]): string {
  const last = events.findLast((e): e is EventOf<'assistant.message'> => e.type === 'assistant.message' && e.text.length > 0);
  return last?.text ?? NO_REPORT_TEXT;
}

function alreadyFinished(child: SessionStore): boolean {
  const last = lastConversationEvent(child.events);
  return last?.type === 'assistant.message' && pendingToolCalls(child.events).length === 0;
}

function tokensSince(events: readonly AgentEvent[], fromSeq: number): number {
  return events
    .filter((e): e is EventOf<'assistant.message'> => e.type === 'assistant.message' && e.seq > fromSeq)
    .reduce((sum, e) => sum + (e.usage.inputTokens ?? 0) + (e.usage.outputTokens ?? 0), 0);
}

function interruptedError(): Error {
  const err = new Error('subagent 已中斷');
  err.name = 'AbortError';
  return err;
}

// subagent 就是一個子 session：用同一套迴圈跑到結束，把最後一則回覆交回給主 agent。
// 子 session 的編號由呼叫位置決定，所以同一個呼叫再執行一次會接續原本的進度，而不是重新開始。
export async function runSubagent(parent: LoopDeps, host: SubagentHost, request: SubagentRequest): Promise<string> {
  const type = host.types.get(request.type);
  if (!type) {
    throw new Error(`沒有名為 ${request.type} 的 subagent 類型。可用的類型：${[...host.types.keys()].join('、')}`);
  }

  const subagentId = `${SUBAGENT_ID_PREFIX}${request.callKey}`;
  const existing = SessionStore.openChild(parent.store, subagentId);
  if (existing && alreadyFinished(existing)) return lastReport(existing.events);

  if (!existing) {
    const turnStart = parent.store.events.findLastIndex((e) => e.type === 'turn.started');
    const startedThisTurn = parent.store.events
      .slice(Math.max(turnStart, 0))
      .filter((e) => e.type === 'subagent.started' && !e.resumed).length;
    if (startedThisTurn >= host.config.maxPerTurn) {
      throw new Error(`這一輪已經交辦了 ${startedThisTurn} 次，達到上限。請自己完成剩下的工作，或向使用者說明目前進度。`);
    }
  }

  const child = existing ?? SessionStore.createChild(parent.store, subagentId, {
    title: request.goal.replace(/\s+/g, ' ').slice(0, GOAL_PREVIEW_CHARS),
    modelId: typeof type.model === 'string' ? type.model : type.model.modelId,
  });

  const emit: LoopDeps['emit'] = (body) => {
    const event = child.append(body);
    parent.publish({ type: 'subagent.event', subagentId, event });
    return event;
  };
  if (!existing) emit({ type: 'user.message', text: briefOf(request) });

  parent.emit({
    type: 'subagent.started', callId: request.callId, subagentId, agentType: type.name,
    goal: request.goal, resumed: existing !== null,
  });
  const startSeq = emit({ type: 'turn.started' }).seq;

  let reason: TurnEndReason;
  try {
    reason = await runTurn({
      config: { ...parent.config, limits: { ...parent.config.limits, maxSteps: type.maxSteps } },
      model: type.model,
      registry: type.registry,
      systemPrompt: type.promptFor(child),
      store: child,
      emit,
      publish: (event) => {
        if (event.type === 'text.delta') parent.publish({ type: 'subagent.event', subagentId, event });
      },
      // subagent 沒有自己的前端，所以核准請求記在主 session 的紀錄裡，由主 session 的前端回覆。
      requestApproval: async (call, signal) => {
        const callId = `${subagentId}${APPROVAL_ID_SEPARATOR}${call.id}`;
        parent.emit({ type: 'tool.approval_requested', callId, name: call.name, input: call.input, subagentId });
        const decision = await parent.requestApproval({ ...call, id: callId }, signal);
        parent.emit({ type: 'tool.approval_resolved', callId, decision, subagentId });
        return decision;
      },
      signal: parent.signal,
      runSubagent: null,
      maxParallelTools: 1,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    emit({ type: 'error', where: 'subagent', message: error.message, stack: error.stack });
    reason = 'error';
  }
  emit({ type: 'turn.finished', reason });
  parent.emit({
    type: 'subagent.finished', callId: request.callId, subagentId, reason,
    tokens: tokensSince(child.events, startSeq),
  });

  if (reason === 'done') return lastReport(child.events);
  if (reason === 'interrupted') throw interruptedError();
  throw new Error(`subagent 沒有完成，原因：${reason}。它最後留下的內容：${lastReport(child.events)}`);
}
