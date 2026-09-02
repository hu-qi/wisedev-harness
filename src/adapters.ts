import { resolve } from 'node:path';
import type { Manifest, RuntimeName } from './manifest.js';
import { writeManagedBlock } from './managed-block.js';

export interface RuntimeAdapter {
  name: RuntimeName;
  target(cwd: string): string;
  render(manifest: Manifest): string;
}

const common = (manifest: Manifest) => [
  '# WiseDev Harness',
  '',
  `Project: ${manifest.project.name}`,
  '',
  'Treat `.agents/manifest.yaml` as the Harness source of truth.',
  'Do not bypass required dependency checks or verification failures.',
  'Preserve existing project conventions unless the manifest explicitly overrides them.',
  'Only modify files relevant to the requested task; never run repository-wide auto-fix by default.'
].join('\n');

const adapters: Record<RuntimeName, RuntimeAdapter> = {
  claude: {
    name: 'claude',
    target: cwd => resolve(cwd, 'CLAUDE.md'),
    render: common
  },
  codex: {
    name: 'codex',
    target: cwd => resolve(cwd, 'AGENTS.md'),
    render: common
  },
  cursor: {
    name: 'cursor',
    target: cwd => resolve(cwd, '.cursor/rules/wisedev-harness.mdc'),
    render: manifest => `---\ndescription: WiseDev Harness project rules\nalwaysApply: true\n---\n\n${common(manifest)}`
  }
};

export function getAdapter(name: RuntimeName): RuntimeAdapter {
  return adapters[name];
}

export async function applyAdapters(manifest: Manifest, cwd = process.cwd()): Promise<string[]> {
  const touched: string[] = [];
  for (const runtime of manifest.runtimes) {
    const adapter = getAdapter(runtime);
    const target = adapter.target(cwd);
    await writeManagedBlock(target, manifest.policies.managedBlockId, adapter.render(manifest));
    touched.push(target);
  }
  return touched;
}
