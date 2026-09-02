import type { AgentId } from './types.js';

export function skillTarget(agent: AgentId, relativePath: string): string {
  switch (agent) {
    case 'claude':
      return `.claude/skills/${relativePath}`;
    case 'codex':
      return `.codex/skills/${relativePath}`;
  }
}

export function claudeRuleTarget(relativePath: string): string {
  return `.claude/rules/wisedev/${relativePath}`;
}

export function agentDisplayName(agent: string): string {
  if (agent === 'claude') return 'Claude Code';
  if (agent === 'codex') return 'Codex';
  return agent;
}
