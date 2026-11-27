import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../../src/core/agent.ts';
import { resolveConfig } from '../../src/core/config.ts';
import type { AgentConfig } from '../../src/core/config.ts';
import type { AgentEvent, StreamEvent } from '../../src/core/events.ts';
import type { SessionRunner } from '../../src/core/runner.ts';
import { startFakeOpenAI } from './fake-openai.ts';
import type { FakeOpenAI, ScriptedReply } from './fake-openai.ts';

export const TEST_API_KEY = 'test-key-123';

export type Harness = {
  agent: Agent;
  fake: FakeOpenAI;
  dir: string;
  cleanup: () => Promise<void>;
};

export async function createHarness(script: ScriptedReply[], overrides: Partial<AgentConfig> = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'agent-test-'));
  const fake = await startFakeOpenAI(script);
  const config = resolveConfig({
    model: { baseURL: fake.baseURL, modelId: 'fake-model', headers: { 'api-key': TEST_API_KEY } },
    skillsDirs: [],
    limits: { modelRetries: 0 },
    ...overrides,
  }, dir);
  const agent = await Agent.create(config);
  return {
    agent, fake, dir,
    async cleanup() {
      await agent.close();
      await fake.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function collect(runner: SessionRunner): StreamEvent[] {
  const seen: StreamEvent[] = [];
  runner.subscribe((event) => seen.push(event));
  return seen;
}

export function types(events: readonly AgentEvent[]): string[] {
  return events.map((e) => e.type);
}

export async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('等待條件逾時');
    await new Promise((r) => setTimeout(r, 10));
  }
}
