import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Manifest, Skill } from './manifest.js';
import { hashTree, readLock } from './distribution.js';

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

function expectedSource(manifest: Manifest, skill: Skill): { url: string; ref: string; path?: string } | null {
  if (skill.source === 'local') return null;
  if (skill.source === 'git') return { url: skill.url, ref: skill.ref, ...(skill.path ? { path: skill.path } : {}) };
  const source = manifest.sources.find(item => item.name === skill.sourceName);
  if (!source) throw new Error(`Skill '${skill.name}' references unknown shared source '${skill.sourceName}'.`);
  return { url: source.url, ref: source.ref, path: skill.path };
}

export interface IntegrityCheck { name: string; ok: boolean; detail: string }

export async function checkDistributionIntegrity(manifest: Manifest, cwd = process.cwd()): Promise<IntegrityCheck[]> {
  const lock = await readLock(cwd);
  const checks: IntegrityCheck[] = [];
  for (const skill of manifest.skills) {
    const expected = expectedSource(manifest, skill);
    if (!expected) continue;
    const pinned = lock?.skills[skill.name];
    if (!pinned) {
      checks.push({ name: `lock:${skill.name}`, ok: false, detail: 'remote skill is not pinned; run wisedev-harness pull' });
      continue;
    }
    const sameSource = pinned.url === expected.url && pinned.ref === expected.ref && pinned.path === expected.path;
    checks.push({ name: `lock:${skill.name}`, ok: sameSource, detail: sameSource ? `commit ${pinned.resolved}` : 'effective source/ref/path differs from lockfile' });
    const target = resolve(cwd, pinned.target);
    if (!(await exists(target))) {
      checks.push({ name: `integrity:${skill.name}`, ok: false, detail: `installed target missing: ${pinned.target}` });
      continue;
    }
    const actual = await hashTree(target);
    checks.push({ name: `integrity:${skill.name}`, ok: actual === pinned.contentSha256, detail: actual === pinned.contentSha256 ? pinned.contentSha256 : `content drift: expected ${pinned.contentSha256}, got ${actual}` });
  }
  return checks;
}
