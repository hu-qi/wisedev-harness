import type { RuntimeName } from './manifest.js';

export interface RuntimeCapability {
  runtime: RuntimeName;
  instructions: string;
  hooks: string;
  mcp: string;
  hookEvents: string[];
  notes: string[];
}

export const CAPABILITIES: Record<RuntimeName, RuntimeCapability> = {
  claude: {
    runtime: 'claude',
    instructions: 'CLAUDE.md managed block',
    hooks: '.claude/settings.json',
    mcp: '.mcp.json',
    hookEvents: ['SessionStart', 'Stop', 'PostToolUse', 'UserPromptSubmit'],
    notes: ['preserves unmanaged settings/hooks/MCP servers', 'MCP injection requires exact-manifest trust']
  },
  codex: {
    runtime: 'codex',
    instructions: 'AGENTS.md managed block',
    hooks: '.codex/hooks.json',
    mcp: '.codex/config.toml managed block',
    hookEvents: ['SessionStart', 'Stop', 'PostToolUse', 'UserPromptSubmit'],
    notes: ['preserves unmanaged hooks/MCP configuration', 'Codex may impose additional product-level trust gates']
  },
  cursor: {
    runtime: 'cursor',
    instructions: '.cursor/rules/wisedev-harness.mdc',
    hooks: '.cursor/hooks.json',
    mcp: '.cursor/mcp.json',
    hookEvents: ['sessionStart', 'stop', 'postToolUse', 'beforeSubmitPrompt'],
    notes: ['Claude event IR is translated to Cursor event names', 'preserves unmanaged hooks/MCP servers', 'MCP injection requires exact-manifest trust']
  }
};

export function capabilityLines(runtimes: RuntimeName[] = ['claude', 'codex', 'cursor']): string[] {
  return runtimes.map(runtime => {
    const item = CAPABILITIES[runtime];
    return `${runtime}\tinstructions=${item.instructions}\thooks=${item.hooks}\tmcp=${item.mcp}\tevents=${item.hookEvents.join(',')}\tnotes=${item.notes.join('; ')}`;
  });
}
