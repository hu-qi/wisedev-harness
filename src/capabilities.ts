import type { RuntimeName } from './manifest.js';

export interface RuntimeCapability {
  runtime: RuntimeName;
  instructions: string;
  hooks: string;
  hookEvents: string[];
  notes: string[];
}

export const CAPABILITIES: Record<RuntimeName, RuntimeCapability> = {
  claude: {
    runtime: 'claude',
    instructions: 'CLAUDE.md managed block',
    hooks: '.claude/settings.json',
    hookEvents: ['SessionStart', 'Stop', 'PostToolUse', 'UserPromptSubmit'],
    notes: ['preserves unmanaged settings/hooks']
  },
  codex: {
    runtime: 'codex',
    instructions: 'AGENTS.md managed block',
    hooks: '.codex/hooks.json',
    hookEvents: ['SessionStart', 'Stop', 'PostToolUse', 'UserPromptSubmit'],
    notes: ['preserves unmanaged hooks', 'Codex may impose an additional product-level hook trust gate']
  },
  cursor: {
    runtime: 'cursor',
    instructions: '.cursor/rules/wisedev-harness.mdc',
    hooks: '.cursor/hooks.json',
    hookEvents: ['sessionStart', 'stop', 'postToolUse', 'beforeSubmitPrompt'],
    notes: ['Claude event IR is translated to Cursor event names', 'preserves unmanaged hooks']
  }
};

export function capabilityLines(runtimes: RuntimeName[] = ['claude', 'codex', 'cursor']): string[] {
  return runtimes.map(runtime => {
    const item = CAPABILITIES[runtime];
    return `${runtime}\tinstructions=${item.instructions}\thooks=${item.hooks}\tevents=${item.hookEvents.join(',')}\tnotes=${item.notes.join('; ')}`;
  });
}
