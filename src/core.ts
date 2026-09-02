import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyAdapters } from './adapters.js';
import { defaultManifest, loadManifest, MANIFEST_PATH, serializeManifest, type Manifest } from './manifest.js';

export interface Check { name: string; ok: boolean; detail: string }

async function exists(path: string) { try { await access(path, constants.F_OK); return true; } catch { return false; } }

export async function initHarness(cwd = process.cwd(), force = false) {
  const manifestPath = resolve(cwd, MANIFEST_PATH);
  await mkdir(resolve(cwd, '.agents'), { recursive: true });
  if (await exists(manifestPath)) {
    if (!force) throw new Error(`${MANIFEST_PATH} already exists; use --force to replace it.`);
  }
  const manifest = defaultManifest(basename(cwd));
  await writeFile(manifestPath, serializeManifest(manifest), 'utf8');
  const touched = await applyAdapters(manifest, cwd);
  await writeFile(resolve(cwd, '.agents/state.json'), JSON.stringify({ schemaVersion: 1, manifestVersion: manifest.version, updatedAt: new Date().toISOString(), runtimes: manifest.runtimes }, null, 2) + '\n');
  return { manifestPath, touched };
}

export async function checkHarness(cwd = process.cwd()): Promise<Check[]> {
  const out: Check[] = [];
  out.push({ name: 'node', ok: Number(process.versions.node.split('.')[0]) >= 20, detail: `Node ${process.versions.node}` });
  try { const v = execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(); out.push({ name: 'git', ok: true, detail: v }); }
  catch { out.push({ name: 'git', ok: false, detail: 'git not found' }); }
  try {
    const manifest = await loadManifest(cwd);
    out.push({ name: 'manifest', ok: true, detail: `${MANIFEST_PATH} schema v${manifest.version}` });
    for (const skill of manifest.skills) {
      if (skill.source !== 'local') continue;
      const path = resolve(cwd, skill.path ?? `.agents/skills/${skill.name}`);
      const ok = await exists(path);
      out.push({ name: `skill:${skill.name}`, ok: ok || !skill.required, detail: ok ? path : `missing ${path}${skill.required ? ' (required)' : ' (optional)'}` });
    }
    for (const rule of manifest.rules) {
      const path = resolve(cwd, rule.path); const ok = await exists(path);
      out.push({ name: `rule:${rule.path}`, ok: ok || !rule.required, detail: ok ? path : `missing ${path}` });
    }
  } catch (error: any) { out.push({ name: 'manifest', ok: false, detail: error?.message ?? String(error) }); }
  return out;
}

export async function verifyHarness(cwd = process.cwd()): Promise<Check[]> {
  const checks = await checkHarness(cwd);
  let manifest: Manifest;
  try { manifest = await loadManifest(cwd); } catch { return checks; }
  for (const runtime of manifest.runtimes) {
    const path = runtime === 'claude' ? resolve(cwd, 'CLAUDE.md') : runtime === 'codex' ? resolve(cwd, 'AGENTS.md') : resolve(cwd, '.cursor/rules/wisedev-harness.mdc');
    try {
      const text = await readFile(path, 'utf8');
      const id = manifest.policies.managedBlockId;
      const ok = text.includes(`<!-- ${id}:start -->`) && text.includes(`<!-- ${id}:end -->`);
      checks.push({ name: `adapter:${runtime}`, ok, detail: ok ? path : `managed block missing in ${path}` });
    } catch { checks.push({ name: `adapter:${runtime}`, ok: false, detail: `missing ${path}` }); }
  }
  return checks;
}

export function hasFailures(checks: Check[]) { return checks.some(c => !c.ok); }
