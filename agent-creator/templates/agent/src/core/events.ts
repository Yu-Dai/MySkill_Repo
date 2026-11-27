export type ToolCallRecord = {
  id: string;
  name: string;
  input: unknown;
  invalid?: string;
};

export type Usage = { inputTokens: number | null; outputTokens: number | null };

export type ApprovalDecision = 'allow' | 'deny';

export type TurnEndReason = 'done' | 'max_steps' | 'token_budget' | 'timeout' | 'interrupted' | 'error';

export type EventBody =
  | { type: 'session.created'; title: string; modelId: string }
  | { type: 'user.message'; text: string }
  | { type: 'turn.started' }
  | { type: 'assistant.message'; text: string; toolCalls: ToolCallRecord[]; usage: Usage; finishReason: string }
  | { type: 'tool.approval_requested'; callId: string; name: string; input: unknown }
  | { type: 'tool.approval_resolved'; callId: string; decision: ApprovalDecision }
  | { type: 'tool.started'; callId: string; name: string }
  | { type: 'tool.result'; callId: string; name: string; ok: boolean; output: string; outputPath?: string; durationMs: number; unknownOutcome?: true }
  | { type: 'context.compacted'; summary: string; uptoSeq: number }
  | { type: 'turn.finished'; reason: TurnEndReason }
  | { type: 'error'; where: string; message: string; stack?: string };

export type AgentEvent = EventBody & { seq: number; ts: string };

export type EventOf<T extends EventBody['type']> = Extract<AgentEvent, { type: T }>;

export type EphemeralEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'fatal'; message: string };

export type StreamEvent = AgentEvent | EphemeralEvent;

export type SessionStatus = 'idle' | 'running' | 'waiting_approval' | 'interrupted';

export function isPersisted(event: StreamEvent): event is AgentEvent {
  return 'seq' in event;
}
