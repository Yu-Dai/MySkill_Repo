import type { ModelMessage } from '#deps';
import type { ContextLimits } from './config.ts';
import type { AgentEvent, ApprovalDecision, EventOf, ToolCallRecord } from './events.ts';

// 粗估用：中英文混合時一個 token 約 3 個字元。只用來判斷要不要壓縮，不需要精準。
const CHARS_PER_TOKEN = 3;
const TRANSCRIPT_TOOL_OUTPUT_CHARS = 500;
const SUMMARY_HEADER = '[以下是較早對話的摘要，原始內容已不在上下文中]\n';

export type PendingCall = {
  call: ToolCallRecord;
  // 模型端給的呼叫編號不保證在整個 session 內唯一，所以加上所屬訊息的序號，作為檔名與子 session 編號的依據。
  callKey: string;
  started: boolean;
  decision: ApprovalDecision | null;
};

const UNSAFE_KEY_CHARS = /[^A-Za-z0-9_-]/g;

type ConversationEvent = EventOf<'user.message'> | EventOf<'assistant.message'> | EventOf<'tool.result'>;

function isConversation(event: AgentEvent): event is ConversationEvent {
  return event.type === 'user.message' || event.type === 'assistant.message' || event.type === 'tool.result';
}

export function lastConversationEvent(events: readonly AgentEvent[]): ConversationEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (isConversation(event)) return event;
  }
  return null;
}

export function pendingToolCalls(events: readonly AgentEvent[]): PendingCall[] {
  const lastAssistantAt = events.findLastIndex((e) => e.type === 'assistant.message');
  if (lastAssistantAt === -1) return [];
  const assistant = events[lastAssistantAt] as EventOf<'assistant.message'>;
  const after = events.slice(lastAssistantAt + 1);
  const finished = new Set(after.filter((e) => e.type === 'tool.result').map((e) => (e as EventOf<'tool.result'>).callId));
  return assistant.toolCalls
    .filter((call) => !finished.has(call.id))
    .map((call) => {
      const resolved = after.find((e) => e.type === 'tool.approval_resolved' && e.callId === call.id) as
        | EventOf<'tool.approval_resolved'>
        | undefined;
      return {
        call,
        callKey: `${assistant.seq}-${call.id.replace(UNSAFE_KEY_CHARS, '_')}`,
        started: after.some((e) => e.type === 'tool.started' && e.callId === call.id),
        decision: resolved?.decision ?? null,
      };
    });
}

function lastCompaction(events: readonly AgentEvent[]): EventOf<'context.compacted'> | null {
  const found = events.findLast((e) => e.type === 'context.compacted');
  return (found as EventOf<'context.compacted'> | undefined) ?? null;
}

function trimmedPlaceholder(event: EventOf<'tool.result'>): string {
  return event.outputPath
    ? `[較早的工具輸出已省略，完整內容在 ${event.outputPath}]`
    : '[較早的工具輸出已省略]';
}

export function buildMessages(
  events: readonly AgentEvent[],
  options: { trimOldToolResults: boolean; keepRecentToolResults: number },
): ModelMessage[] {
  const compaction = lastCompaction(events);
  const visible = events.filter((e) => e.seq > (compaction?.uptoSeq ?? 0));
  const resultCount = visible.filter((e) => e.type === 'tool.result').length;
  const trimBelow = options.trimOldToolResults ? resultCount - options.keepRecentToolResults : 0;

  const messages: ModelMessage[] = [];
  if (compaction) messages.push({ role: 'user', content: SUMMARY_HEADER + compaction.summary });

  let resultIndex = 0;
  for (const event of visible) {
    if (event.type === 'user.message') {
      messages.push({ role: 'user', content: event.text });
    } else if (event.type === 'assistant.message') {
      const parts: any[] = [];
      if (event.text) parts.push({ type: 'text', text: event.text });
      for (const call of event.toolCalls) {
        const input = call.input !== null && typeof call.input === 'object' ? call.input : {};
        parts.push({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input });
      }
      if (parts.length > 0) messages.push({ role: 'assistant', content: parts });
    } else if (event.type === 'tool.result') {
      const value = resultIndex < trimBelow ? trimmedPlaceholder(event) : event.output;
      resultIndex += 1;
      const part = {
        type: 'tool-result' as const,
        toolCallId: event.callId,
        toolName: event.name,
        output: { type: event.ok ? ('text' as const) : ('error-text' as const), value },
      };
      const previous = messages[messages.length - 1];
      if (previous?.role === 'tool') (previous.content as any[]).push(part);
      else messages.push({ role: 'tool', content: [part] });
    }
  }
  return messages;
}

export function estimateTokens(systemPrompt: string, messages: ModelMessage[]): number {
  return Math.ceil((systemPrompt.length + JSON.stringify(messages).length) / CHARS_PER_TOKEN);
}

export type CompactionPlan = { uptoSeq: number; transcript: string };

// 切點一定落在 user 或 assistant 訊息之前，這樣 tool 結果永遠跟著它所屬的 assistant 訊息，不會被切開。
export function planCompaction(events: readonly AgentEvent[], limits: ContextLimits): CompactionPlan | null {
  const compaction = lastCompaction(events);
  const visible = events.filter((e) => e.seq > (compaction?.uptoSeq ?? 0));
  const turns = visible.filter((e) => e.type === 'user.message' || e.type === 'assistant.message');
  if (turns.length <= limits.keepRecentMessages) return null;
  const firstKept = turns[turns.length - limits.keepRecentMessages];
  const uptoSeq = firstKept.seq - 1;

  const lines: string[] = [];
  if (compaction) lines.push(`先前的摘要：\n${compaction.summary}\n`);
  for (const event of visible) {
    if (event.seq > uptoSeq) break;
    if (event.type === 'user.message') lines.push(`使用者：${event.text}`);
    else if (event.type === 'assistant.message') {
      if (event.text) lines.push(`助理：${event.text}`);
      for (const call of event.toolCalls) lines.push(`助理呼叫工具 ${call.name}：${JSON.stringify(call.input)}`);
    } else if (event.type === 'tool.result') {
      const status = event.ok ? '成功' : '失敗';
      lines.push(`工具 ${event.name} ${status}：${event.output.slice(0, TRANSCRIPT_TOOL_OUTPUT_CHARS)}`);
    }
  }
  if (lines.length === 0) return null;
  return { uptoSeq, transcript: lines.join('\n') };
}

export const COMPACTION_INSTRUCTIONS = [
  '你要把一段助理與使用者的工作紀錄濃縮成摘要，讓助理之後只看摘要也能接著做。',
  '保留：使用者的目標與限制、已完成的事、做過的決定與原因、重要的檔案路徑與數值、尚未完成的事。',
  '省略：寒暄、重複內容、已經不重要的中間嘗試。',
  '直接輸出摘要內容，不要加開場白。',
].join('\n');
