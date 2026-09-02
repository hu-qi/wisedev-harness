import { spawnSync } from 'node:child_process';
import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { HARNESS_GITIGNORE_PATH, MANIFEST_PATH } from './constants.js';
import { HarnessError } from './errors.js';
import { agentDisplayName, claudeRuleTarget, cursorRuleContent, cursorRuleTarget, skillTarget } from './adapters.js';
import { createDefaultManifest, diagnoseManifestSources, loadManifest, serializeManifest } from './manifest.js';
import { buildCodexRulesBlock, codexBlockHash, extractCodexRulesBlock, replaceCodexRulesBlock, type RuleSource } from './rules.js';
import type { AgentId, Diagnostic, HarnessManifest, HarnessState, ManagedEntry, Operation, SyncResult, VerifyResult } from './types.js';
import { exists, listSourceFiles, readState, readUtf8, removeFile, resolveInside, sha256, writeAtomic, writeState } from './utils.js';

interface ExpectedEntry {
  kind: 'file' | 'codex-rules-block';
  path: string;
  content: string;
  hash: string;
  source?: string;
}

interface PendingChange {
  type: 'write' | 'delete';
  path: string;
  absolutePath: string;
  content?: string;
  reason: string;
}

export interface InitOptions {
  force?: boolean;
  agents?: AgentId[];
}

export interface SyncOptions {
  force?: boolean;
  dryRun?: boolean;
}

export interface InitResult {
  changed: boolean;
  diagnostics: Diagnostic[];
  operations: Operation[];
}

function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((item) => item.level === 'error');
}

function diagnosticFromError(error: unknown): Diagnostic {
  if (error instanceof HarnessError) {
    return { level: 'error', code: error.code, message: error.message };
  }
  return { level: 'error', code: 'UNEXPECTED_ERROR', message: error instanceof Error ? error.message : String(error) };
}

export async function initProject(root: string, options: InitOptions = {}): Promise<InitResult> {
  const projectRoot = path.resolve(root);
  const manifestPath = resolveInside(projectRoot, MANIFEST_PATH);
  const diagnostics: Diagnostic[] = [];
  const operations: Operation[] = [];

  if ((await exists(manifestPath)) && !options.force) {
    diagnostics.push({ level: 'warning', code: 'ALREADY_INITIALIZED', message: `${MANIFEST_PATH} already exists; no files were changed`, path: MANIFEST_PATH });
    return { changed: false, diagnostics, operations };
  }

  const agents = options.agents && options.agents.length > 0 ? [...new Set(options.agents)] : ['claude', 'codex'];
  const manifest = createDefaultManifest(path.basename(projectRoot), agents);

  await mkdir(resolveInside(projectRoot, '.agents/skills'), { recursive: true });
  await mkdir(resolveInside(projectRoot, '.agents/rules'), { recursive: true });
  await writeAtomic(manifestPath, serializeManifest(manifest));
  operations.push({ type: 'write', path: MANIFEST_PATH, reason: options.force ? 'replace harness manifest by explicit request' : 'create harness manifest' });

  const ignorePath = resolveInside(projectRoot, HARNESS_GITIGNORE_PATH);
  const currentIgnore = (await exists(ignorePath)) ? await readUtf8(ignorePath) : '';
  const ignoreLines = new Set(currentIgnore.split(/\r?\n/).filter(Boolean));
  if (!ignoreLines.has('state.json')) {
    ignoreLines.add('state.json');
    await writeAtomic(ignorePath, `${[...ignoreLines].join('\n')}\n`);
    operations.push({ type: 'write', path: HARNESS_GITIGNORE_PATH, reason: 'keep local synchronization state out of source control' });
  }

  diagnostics.push({ level: 'info', code: 'INITIALIZED', message: `Initialized WiseDev Harness for ${agents.map(agentDisplayName).join(' + ')}` });
  return { changed: operations.length > 0, diagnostics, operations };
}

export async function checkProject(root: string): Promise<Diagnostic[]> {
  const projectRoot = path.resolve(root);
  const diagnostics: Diagnostic[] = [];

  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (nodeMajor < 20) {
    diagnostics.push({ level: 'error', code: 'NODE_VERSION_UNSUPPORTED', message: `Node.js >=20 is required; found ${process.versions.node}` });
  } else {
    diagnostics.push({ level: 'info', code: 'NODE_VERSION_OK', message: `Node.js ${process.versions.node}` });
  }

  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: projectRoot, encoding: 'utf8' });
  if (git.status !== 0) {
    diagnostics.push({ level: 'warning', code: 'GIT_NOT_DETECTED', message: 'Project is not inside a Git worktree; Harness can run, but reproducible team distribution is reduced' });
  }

  try {
    const loaded = await loadManifest(projectRoot);
    diagnostics.push({ level: 'info', code: 'MANIFEST_OK', message: `${MANIFEST_PATH} is valid for ${loaded.manifest.agents.join(', ')}` });
    diagnostics.push(...await diagnoseManifestSources(projectRoot, loaded.manifest));
  } catch (error) {
    diagnostics.push(diagnosticFromError(error));
  }

  return diagnostics;
}

async function collectExpected(root: string, manifest: HarnessManifest): Promise<{ entries: ExpectedEntry[]; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const byKey = new Map<string, ExpectedEntry>();
  const rules: RuleSource[] = [];

  const add = (entry: ExpectedEntry): void => {
    const key = `${entry.kind}:${entry.path}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      return;
    }
    if (existing.hash !== entry.hash) {
      diagnostics.push({ level: 'error', code: 'TARGET_COLLISION', message: `Multiple resources produce different content for ${entry.path}`, path: entry.path });
    }
  };

  try {
    for (const sourceRoot of manifest.resources.skills) {
      for (const file of await listSourceFiles(root, sourceRoot)) {
        const source = `${sourceRoot.replace(/\/$/, '')}/${file.relativePath}`;
        for (const agent of manifest.agents) {
          const target = skillTarget(agent, file.relativePath);
          add({ kind: 'file', path: target, content: file.content, hash: sha256(file.content), source });
        }
      }
    }

    for (const sourceRoot of manifest.resources.rules) {
      for (const file of await listSourceFiles(root, sourceRoot)) {
        const source = `${sourceRoot.replace(/\/$/, '')}/${file.relativePath}`;
        rules.push({ source, content: file.content });
        if (manifest.agents.includes('claude')) {
          const target = claudeRuleTarget(file.relativePath);
          add({ kind: 'file', path: target, content: file.content, hash: sha256(file.content), source });
        }
        if (manifest.agents.includes('cursor')) {
          const target = cursorRuleTarget(file.relativePath);
          const content = cursorRuleContent(source, file.content);
          add({ kind: 'file', path: target, content, hash: sha256(content), source });
        }
      }
    }
  } catch (error) {
    diagnostics.push(diagnosticFromError(error));
  }

  if (manifest.agents.includes('codex')) {
    const block = buildCodexRulesBlock(rules);
    if (block) {
      add({ kind: 'codex-rules-block', path: 'AGENTS.md', content: block, hash: codexBlockHash(block), source: manifest.resources.rules.join(', ') });
    }
  }

  return { entries: [...byKey.values()].sort((a, b) => `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`)), diagnostics };
}

async function fileHash(target: string): Promise<string | null> {
  if (!(await exists(target))) return null;
  const stat = await lstat(target);
  if (stat.isSymbolicLink()) throw new HarnessError('TARGET_SYMLINK_REJECTED', `Managed target cannot be a symlink: ${target}`);
  if (!stat.isFile()) throw new HarnessError('TARGET_NOT_FILE', `Managed target is not a regular file: ${target}`);
  return sha256(await readUtf8(target));
}

function stateKey(entry: Pick<ManagedEntry, 'kind' | 'path'>): string {
  return `${entry.kind}:${entry.path}`;
}

export async function syncProject(root: string, options: SyncOptions = {}): Promise<SyncResult> {
  const projectRoot = path.resolve(root);
  const diagnostics = await checkProject(projectRoot);
  if (hasErrors(diagnostics)) return { operations: [], diagnostics, changed: false };

  let loaded;
  try {
    loaded = await loadManifest(projectRoot);
  } catch (error) {
    diagnostics.push(diagnosticFromError(error));
    return { operations: [], diagnostics, changed: false };
  }

  const expectedResult = await collectExpected(projectRoot, loaded.manifest);
  diagnostics.push(...expectedResult.diagnostics);
  if (hasErrors(diagnostics)) return { operations: [], diagnostics, changed: false };

  const state = await readState(projectRoot);
  const previousByKey = new Map((state?.managed ?? []).map((entry) => [stateKey(entry), entry]));
  const expectedByKey = new Map(expectedResult.entries.map((entry) => [stateKey(entry), entry]));
  const changes: PendingChange[] = [];
  const operations: Operation[] = [];
  const overwriteAllowed = options.force === true || loaded.manifest.policies.conflict === 'overwrite';

  for (const entry of expectedResult.entries) {
    const previous = previousByKey.get(stateKey(entry));
    const absolute = resolveInside(projectRoot, entry.path);

    if (entry.kind === 'file') {
      try {
        const currentHash = await fileHash(absolute);
        if (currentHash === entry.hash) {
          operations.push({ type: 'noop', path: entry.path, reason: 'already synchronized' });
          continue;
        }
        const safeToReplace = currentHash === null || (previous?.kind === 'file' && currentHash === previous.hash);
        if (!safeToReplace && !overwriteAllowed) {
          diagnostics.push({ level: 'error', code: 'MANAGED_TARGET_CONFLICT', message: `Refusing to overwrite locally modified or unmanaged target: ${entry.path}`, path: entry.path });
          continue;
        }
        if (!safeToReplace) {
          diagnostics.push({ level: 'warning', code: 'FORCED_OVERWRITE', message: `Overwriting conflicting target by policy: ${entry.path}`, path: entry.path });
        }
        changes.push({ type: 'write', path: entry.path, absolutePath: absolute, content: entry.content, reason: currentHash === null ? 'install managed resource' : 'update managed resource' });
        operations.push({ type: 'write', path: entry.path, reason: currentHash === null ? 'install managed resource' : 'update managed resource' });
      } catch (error) {
        diagnostics.push(diagnosticFromError(error));
      }
      continue;
    }

    try {
      const original = (await exists(absolute)) ? await readUtf8(absolute) : '';
      const currentBlock = extractCodexRulesBlock(original);
      const currentHash = currentBlock ? codexBlockHash(currentBlock) : null;
      if (currentHash === entry.hash) {
        operations.push({ type: 'noop', path: entry.path, reason: 'managed Codex rules block already synchronized' });
        continue;
      }
      const safeToReplace = currentBlock === null || (previous?.kind === 'codex-rules-block' && currentHash === previous.hash);
      if (!safeToReplace && !overwriteAllowed) {
        diagnostics.push({ level: 'error', code: 'MANAGED_BLOCK_CONFLICT', message: 'Refusing to overwrite a locally modified WiseDev block in AGENTS.md', path: entry.path });
        continue;
      }
      if (!safeToReplace) {
        diagnostics.push({ level: 'warning', code: 'FORCED_OVERWRITE', message: 'Overwriting locally modified WiseDev block in AGENTS.md by policy', path: entry.path });
      }
      changes.push({ type: 'write', path: entry.path, absolutePath: absolute, content: replaceCodexRulesBlock(original, entry.content), reason: currentBlock ? 'update managed Codex rules block' : 'install managed Codex rules block' });
      operations.push({ type: 'write', path: entry.path, reason: currentBlock ? 'update managed Codex rules block' : 'install managed Codex rules block' });
    } catch (error) {
      diagnostics.push(diagnosticFromError(error));
    }
  }

  for (const previous of state?.managed ?? []) {
    if (expectedByKey.has(stateKey(previous))) continue;
    const absolute = resolveInside(projectRoot, previous.path);
    try {
      if (previous.kind === 'file') {
        const currentHash = await fileHash(absolute);
        if (currentHash === null) {
          operations.push({ type: 'noop', path: previous.path, reason: 'stale managed resource already absent' });
        } else if (currentHash === previous.hash) {
          changes.push({ type: 'delete', path: previous.path, absolutePath: absolute, reason: 'remove stale managed resource' });
          operations.push({ type: 'delete', path: previous.path, reason: 'remove stale managed resource' });
        } else {
          diagnostics.push({ level: 'error', code: 'STALE_TARGET_MODIFIED', message: `Stale managed target was locally modified and will not be deleted: ${previous.path}`, path: previous.path });
        }
      } else if (await exists(absolute)) {
        const original = await readUtf8(absolute);
        const currentBlock = extractCodexRulesBlock(original);
        if (!currentBlock) {
          operations.push({ type: 'noop', path: previous.path, reason: 'stale managed rules block already absent' });
        } else if (codexBlockHash(currentBlock) === previous.hash) {
          changes.push({ type: 'write', path: previous.path, absolutePath: absolute, content: replaceCodexRulesBlock(original, null), reason: 'remove stale managed Codex rules block' });
          operations.push({ type: 'write', path: previous.path, reason: 'remove stale managed Codex rules block' });
        } else {
          diagnostics.push({ level: 'error', code: 'STALE_BLOCK_MODIFIED', message: 'Stale WiseDev rules block in AGENTS.md was modified and will not be removed', path: previous.path });
        }
      }
    } catch (error) {
      diagnostics.push(diagnosticFromError(error));
    }
  }

  if (hasErrors(diagnostics)) return { operations, diagnostics, changed: false };
  if (options.dryRun) {
    diagnostics.push({ level: 'info', code: 'DRY_RUN', message: `Dry run complete; ${changes.length} change(s) would be applied` });
    return { operations, diagnostics, changed: changes.length > 0 };
  }

  for (const change of changes) {
    if (change.type === 'write') {
      await writeAtomic(change.absolutePath, change.content ?? '');
    } else {
      await removeFile(change.absolutePath);
    }
  }

  const nextState: HarnessState = {
    version: 1,
    manifestHash: loaded.hash,
    managed: expectedResult.entries.map((entry): ManagedEntry => ({
      kind: entry.kind,
      path: entry.path,
      hash: entry.hash,
      ...(entry.source ? { source: entry.source } : {}),
    })),
    syncedAt: new Date().toISOString(),
  };
  await writeState(projectRoot, nextState);
  diagnostics.push({ level: 'info', code: 'SYNC_COMPLETE', message: `Synchronization complete; ${changes.length} change(s) applied` });
  return { operations, diagnostics, changed: changes.length > 0 };
}

export async function planProject(root: string, options: Omit<SyncOptions, 'dryRun'> = {}): Promise<SyncResult> {
  return syncProject(root, { ...options, dryRun: true });
}

export async function verifyProject(root: string): Promise<VerifyResult> {
  const projectRoot = path.resolve(root);
  const diagnostics = await checkProject(projectRoot);
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };

  const state = await readState(projectRoot);
  if (!state) {
    diagnostics.push({ level: 'error', code: 'NOT_SYNCHRONIZED', message: 'No valid .agents/state.json was found; run wisedev-harness sync first' });
    return { ok: false, diagnostics };
  }

  let loaded;
  try {
    loaded = await loadManifest(projectRoot);
  } catch (error) {
    diagnostics.push(diagnosticFromError(error));
    return { ok: false, diagnostics };
  }

  if (state.manifestHash !== loaded.hash) {
    diagnostics.push({ level: 'error', code: 'MANIFEST_DRIFT', message: 'Manifest changed after the last synchronization; run wisedev-harness sync' });
  }

  const expectedResult = await collectExpected(projectRoot, loaded.manifest);
  diagnostics.push(...expectedResult.diagnostics);
  const stateByKey = new Map(state.managed.map((entry) => [stateKey(entry), entry]));
  const expectedByKey = new Map(expectedResult.entries.map((entry) => [stateKey(entry), entry]));

  for (const entry of expectedResult.entries) {
    const tracked = stateByKey.get(stateKey(entry));
    if (!tracked || tracked.hash !== entry.hash) {
      diagnostics.push({ level: 'error', code: 'STATE_DRIFT', message: `Local state does not match expected managed resource: ${entry.path}`, path: entry.path });
    }
    const absolute = resolveInside(projectRoot, entry.path);
    try {
      if (entry.kind === 'file') {
        const currentHash = await fileHash(absolute);
        if (currentHash === null) {
          diagnostics.push({ level: 'error', code: 'MANAGED_TARGET_MISSING', message: `Managed target is missing: ${entry.path}`, path: entry.path });
        } else if (currentHash !== entry.hash) {
          diagnostics.push({ level: 'error', code: 'MANAGED_TARGET_DRIFT', message: `Managed target differs from its source: ${entry.path}`, path: entry.path });
        }
      } else {
        if (!(await exists(absolute))) {
          diagnostics.push({ level: 'error', code: 'MANAGED_BLOCK_MISSING', message: 'AGENTS.md is missing the managed WiseDev rules block', path: entry.path });
        } else {
          const currentBlock = extractCodexRulesBlock(await readUtf8(absolute));
          if (!currentBlock || codexBlockHash(currentBlock) !== entry.hash) {
            diagnostics.push({ level: 'error', code: 'MANAGED_BLOCK_DRIFT', message: 'AGENTS.md WiseDev rules block differs from its sources', path: entry.path });
          }
        }
      }
    } catch (error) {
      diagnostics.push(diagnosticFromError(error));
    }
  }

  for (const tracked of state.managed) {
    if (!expectedByKey.has(stateKey(tracked))) {
      diagnostics.push({ level: 'error', code: 'STALE_MANAGED_STATE', message: `State still tracks a resource no longer declared by the manifest: ${tracked.path}`, path: tracked.path });
    }
  }

  const ok = !hasErrors(diagnostics);
  if (ok) diagnostics.push({ level: 'info', code: 'VERIFY_OK', message: 'Harness state and managed targets are consistent' });
  return { ok, diagnostics };
}
