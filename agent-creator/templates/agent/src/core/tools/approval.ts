import type { ApprovalPolicy } from '../config.ts';
import type { AgentTool } from './registry.ts';

const WILDCARD = '*';

function matches(pattern: string, name: string): boolean {
  if (pattern.endsWith(WILDCARD)) return name.startsWith(pattern.slice(0, -WILDCARD.length));
  return pattern === name;
}

export function needsApproval(definition: AgentTool, policy: ApprovalPolicy): boolean {
  if (policy.mode === 'never') return false;
  if (definition.risk === 'read') return false;
  return !policy.allow.some((pattern) => matches(pattern, definition.name));
}
