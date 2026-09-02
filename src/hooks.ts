import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { HookDef, Manifest, RuntimeName } from './manifest.js';
import { isManifestTrusted } from './trust.js';

const PREFIX = 'wisedev-harness hook-run ';
const DESCRIPTION_PREFIX = '[wisedev-harness:hook:';

const CURSOR_EVENTS: Record<HookDef['event'], string> = {
  SessionStart: 'sessionStart',
  Stop: 'stop',
  PostToolUse: 'postToolUse',
  UserPromptSubmit: 'beforeSubmitPrompt'
};

async function readJson(path: string): Promise<any> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error: any) { if (error?.code === 'ENOENT') return {}; throw error; }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

function runtimeHooks(manifest: Manifest, runtime: RuntimeName): HookDef[] {
  return manifest.hooks.filter(hook => !hook.runtimes || hook.runtimes.includes(runtime));
}

function managedCommand(command?: string): boolean {
  return typeof command === 'string' && command.startsWith(PREFIX);
}

function hookCommand(id: string): string {
  return `${PREFIX}${id}`;
}

async function reconcileClaude(manifest: Manifest, cwd: string, remove = false): Promise<string> {
  const path = resolve(cwd, '.claude/settings.json');
  const json = await readJson(path);
  json.hooks ??= {};
  for (const [event, entries] of Object.entries(json.hooks as Record<string, any[]>)) {
    json.hooks[event] = entries.filter(entry => {
      const command = entry?.hooks?.[0]?.command;
      return !(managedCommand(command) || String(entry?.description ?? '').startsWith(DESCRIPTION_PREFIX));
    });
  }
  if (!remove) {
    for (const hook of runtimeHooks(manifest, 'claude')) {
      json.hooks[hook.event] ??= [];
      json.hooks[hook.event].push({
        matcher: hook.matcher,
        description: `${DESCRIPTION_PREFIX}${hook.id}] ${hook.description}`,
        hooks: [{ type: 'command', command: hookCommand(hook.id), ...(hook.timeout ? { timeout: hook.timeout } : {}) }]
      });
    }
  }
  await writeJson(path, json);
  return path;
}

async function reconcileCodex(manifest: Manifest, cwd: string, remove = false): Promise<string> {
  const path = resolve(cwd, '.codex/hooks.json');
  const json = await readJson(path);
  json.hooks ??= {};
  for (const [event, entries] of Object.entries(json.hooks as Record<string, any[]>)) {
    json.hooks[event] = entries.filter(entry => !managedCommand(entry?.hooks?.[0]?.command));
  }
  if (!remove) {
    for (const hook of runtimeHooks(manifest, 'codex')) {
      json.hooks[hook.event] ??= [];
      json.hooks[hook.event].push({
        ...(hook.matcher !== '*' ? { matcher: hook.matcher } : {}),
        hooks: [{ type: 'command', command: hookCommand(hook.id), ...(hook.timeout ? { timeout: hook.timeout } : {}) }]
      });
    }
  }
  await writeJson(path, json);
  return path;
}

async function reconcileCursor(manifest: Manifest, cwd: string, remove = false): Promise<string> {
  const path = resolve(cwd, '.cursor/hooks.json');
  const json = await readJson(path);
  json.version ??= 1;
  json.hooks ??= {};
  for (const [event, entries] of Object.entries(json.hooks as Record<string, any[]>)) {
    json.hooks[event] = entries.filter(entry => !managedCommand(entry?.command));
  }
  if (!remove) {
    for (const hook of runtimeHooks(manifest, 'cursor')) {
      const event = CURSOR_EVENTS[hook.event];
      json.hooks[event] ??= [];
      json.hooks[event].push({ command: hookCommand(hook.id), ...(hook.timeout ? { timeout: hook.timeout } : {}), ...(hook.matcher !== '*' ? { matcher: hook.matcher } : {}) });
    }
  }
  await writeJson(path, json);
  return path;
}

export async function injectHooks(manifest: Manifest, cwd = process.cwd()): Promise<string[]> {
  const files: string[] = [];
  for (const runtime of manifest.runtimes) {
    if (runtime === 'claude') files.push(await reconcileClaude(manifest, cwd));
    if (runtime === 'codex') files.push(await reconcileCodex(manifest, cwd));
    if (runtime === 'cursor') files.push(await reconcileCursor(manifest, cwd));
  }
  return files;
}

export async function removeHooks(manifest: Manifest, cwd = process.cwd()): Promise<string[]> {
  const files: string[] = [];
  for (const runtime of manifest.runtimes) {
    if (runtime === 'claude') files.push(await reconcileClaude(manifest, cwd, true));
    if (runtime === 'codex') files.push(await reconcileCodex(manifest, cwd, true));
    if (runtime === 'cursor') files.push(await reconcileCursor(manifest, cwd, true));
  }
  return files;
}

export async function runHook(manifest: Manifest, id: string, cwd = process.cwd()): Promise<number> {
  const hook = manifest.hooks.find(item => item.id === id);
  if (!hook) throw new Error(`Unknown hook '${id}'.`);
  if (manifest.policies.requireHookTrust && !(await isManifestTrusted(cwd))) {
    throw new Error('Manifest is not trusted or changed since trust was granted. Run `wisedev-harness trust` after reviewing .agents/manifest.yaml.');
  }
  const result = spawnSync('sh', ['-lc', hook.command], {
    cwd,
    stdio: 'inherit',
    timeout: (hook.timeout ?? 60) * 1000,
    env: { ...process.env, WISEDEV_HOOK_ID: hook.id, WISEDEV_HOOK_EVENT: hook.event }
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export function listHooks(manifest: Manifest): string[] {
  return manifest.hooks.map(hook => `${hook.id}\t${hook.event}\t${hook.runtimes?.join(',') ?? manifest.runtimes.join(',')}\t${hook.command}`);
}
