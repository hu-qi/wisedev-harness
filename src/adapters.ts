import path from 'node:path';
import type { AgentId } from './types.js';

export function skillTarget(agent: AgentId, relativePath: string): string {
  switch (agent) {
    case 'claude':
      return `.claude/skills/${relativePath}`;
    case 'codex':
      return `.codex/skills/${relativePath}`;
    case 'cursor':
      return `.cursor/skills/${relativePath}`;
    case 'opencode':
      return `.opencode/skills/${relativePath}`;
  }
}

export function claudeRuleTarget(relativePath: string): string {
  return `.claude/rules/wisedev/${relativePath}`;
}

export function cursorRuleTarget(relativePath: string): string {
  const parsed = path.posix.parse(relativePath.replaceAll('\\', '/'));
  const fileName = `${parsed.name || 'rule'}.mdc`;
  return `.cursor/rules/wisedev/${parsed.dir ? `${parsed.dir}/` : ''}${fileName}`;
}

export function cursorRuleContent(source: string, content: string): string {
  const description = JSON.stringify(`WiseDev managed rule from ${source}`);
  return `---\ndescription: ${description}\nalwaysApply: true\n---\n\n${content.trim()}\n`;
}

export function opencodeRuleTarget(relativePath: string): string {
  const parsed = path.posix.parse(relativePath.replaceAll('\\', '/'));
  const fileName = `${parsed.name || 'rule'}.md`;
  return `.opencode/rules/wisedev/${parsed.dir ? `${parsed.dir}/` : ''}${fileName}`;
}

export function agentDisplayName(agent: string): string {
  if (agent === 'claude') return 'Claude Code';
  if (agent === 'codex') return 'Codex';
  if (agent === 'cursor') return 'Cursor';
  if (agent === 'opencode') return 'OpenCode';
  return agent;
}
