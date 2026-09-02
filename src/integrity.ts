import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { Manifest } from './manifest.js';
import { readLock } from './distribution.js';

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function hashTree(root: string): Promise<string> {
  const hasher = createHash('sha256');
  async function walk(path: string): Promise<void> {
    const info = await stat(path);
    if (info.isDirectory()) {
      const entries = (await readdir(path, { withFileTypes: true })).filter(e => e.name !== '.git').sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) await walk(join(path, entry.name));
      return;
    }
    if (!info.isFile()) return;
    hasher.update(`file:${relative(root, path).split(sep).join('/')}\0`);
    hasher.update(await readFile(path));
    hasher.update('\0');
  }
  await walk(root);
  return hasher.digest('hex');
}

export interface IntegrityCheck { name: string; ok: boolean; detail: string }

export async function checkDistributionIntegrity(manifest: Manifest, cwd = process.cwd()): Promise<IntegrityCheck[]> {
  const lock = await readLock(cwd);
  const checks: IntegrityCheck[] = [];
  for (const skill of manifest.skills) {
    if (skill.source !== 'git') continue;
    const pinned = lock?.skills[skill.name];
    if (!pinned) {
      checks.push({ name: `lock:${skill.name}`, ok: false, detail: 'git skill is not pinned; run wisedev-harness pull' });
      continue;
    }
    const sameSource = pinned.url === skill.url && pinned.ref === skill.ref && pinned.path === skill.path;
    checks.push({ name: `lock:${skill.name}`, ok: sameSource, detail: sameSource ? `commit ${pinned.resolved}` : 'manifest source/ref/path differs from lockfile' });
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
