import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type { Manifest, Skill } from './manifest.js';

export interface LockedGitSkill {
  source: 'git';
  url: string;
  ref: string;
  resolved: string;
  path?: string;
  contentSha256: string;
  target: string;
}

export interface HarnessLock {
  version: 1;
  generatedAt: string;
  skills: Record<string, LockedGitSkill>;
}

export const LOCK_PATH = '.agents/harness.lock.json';
const HISTORY_DIR = '.agents/history';
const CACHE_DIR = '.agents/cache/git';
const SKILLS_DIR = '.agents/skills';

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function cacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 24);
}

function assertSafeRelativePath(path: string): void {
  if (!path || path === '.') return;
  if (path.startsWith('/') || path.includes(`..${sep}`) || path === '..' || path.includes('../') || path.includes('\\..\\')) {
    throw new Error(`Unsafe relative path: ${path}`);
  }
}

function assertGitUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error(`Only https git sources are supported in v0.2: ${url}`);
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function copyTree(source: string, target: string): Promise<void> {
  const info = await stat(source);
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      await copyTree(join(source, entry.name), join(target, entry.name));
    }
    return;
  }
  if (!info.isFile()) throw new Error(`Unsupported resource type at ${source}`);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
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
    const rel = relative(root, path).split(sep).join('/');
    hasher.update(`file:${rel}\0`);
    hasher.update(await readFile(path));
    hasher.update('\0');
  }
  await walk(root);
  return hasher.digest('hex');
}

async function installTree(source: string, target: string): Promise<void> {
  const staging = `${target}.staging-${process.pid}-${Date.now()}`;
  await rm(staging, { recursive: true, force: true });
  await copyTree(source, staging);
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await rename(staging, target);
}

async function ensureRepo(cwd: string, url: string): Promise<string> {
  assertGitUrl(url);
  const dir = resolve(cwd, CACHE_DIR, cacheKey(url));
  if (!(await exists(join(dir, '.git')))) {
    await mkdir(dirname(dir), { recursive: true });
    git(['clone', '--no-checkout', '--filter=blob:none', '--', url, dir]);
  } else {
    git(['remote', 'set-url', 'origin', url], dir);
  }
  return dir;
}

function resolveRemoteRef(repoDir: string, ref: string): string {
  git(['fetch', '--force', '--tags', 'origin', ref], repoDir);
  return git(['rev-parse', 'FETCH_HEAD'], repoDir);
}

function ensureCommit(repoDir: string, commit: string): void {
  try { git(['cat-file', '-e', `${commit}^{commit}`], repoDir); }
  catch { git(['fetch', '--force', 'origin', commit], repoDir); }
  git(['checkout', '--detach', '--force', commit], repoDir);
  git(['clean', '-fdx'], repoDir);
}

export async function readLock(cwd = process.cwd()): Promise<HarnessLock | null> {
  try {
    const raw = JSON.parse(await readFile(resolve(cwd, LOCK_PATH), 'utf8')) as HarnessLock;
    if (raw.version !== 1 || typeof raw.skills !== 'object') throw new Error('unsupported lock schema');
    return raw;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`Invalid ${LOCK_PATH}: ${error?.message ?? String(error)}`);
  }
}

async function snapshotLock(cwd: string): Promise<void> {
  const current = await readLock(cwd);
  if (!current) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve(cwd, HISTORY_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${stamp}.lock.json`), JSON.stringify(current, null, 2) + '\n');
}

async function writeLock(cwd: string, lock: HarnessLock): Promise<void> {
  await mkdir(resolve(cwd, '.agents'), { recursive: true });
  await writeFile(resolve(cwd, LOCK_PATH), JSON.stringify(lock, null, 2) + '\n');
}

async function resolveGitSkill(cwd: string, skill: Extract<Skill, { source: 'git' }>, pinned?: LockedGitSkill): Promise<LockedGitSkill> {
  assertSafeRelativePath(skill.path ?? '.');
  const repoDir = await ensureRepo(cwd, skill.url);
  const resolved = pinned?.resolved ?? resolveRemoteRef(repoDir, skill.ref);
  ensureCommit(repoDir, resolved);
  const source = resolve(repoDir, skill.path ?? '.');
  if (!(await exists(source))) throw new Error(`Skill '${skill.name}' path not found at ${skill.path ?? '.'}`);
  const target = resolve(cwd, SKILLS_DIR, skill.name);
  await installTree(source, target);
  return {
    source: 'git', url: skill.url, ref: skill.ref, resolved,
    ...(skill.path ? { path: skill.path } : {}),
    contentSha256: await hashTree(target),
    target: relative(cwd, target).split(sep).join('/')
  };
}

function matchingPin(skill: Extract<Skill, { source: 'git' }>, locked?: LockedGitSkill): LockedGitSkill | undefined {
  if (!locked) return undefined;
  return locked.url === skill.url && locked.ref === skill.ref && locked.path === skill.path ? locked : undefined;
}

export async function pullHarness(manifest: Manifest, cwd = process.cwd(), update = false): Promise<HarnessLock> {
  const previous = await readLock(cwd);
  const next: HarnessLock = { version: 1, generatedAt: new Date().toISOString(), skills: {} };
  for (const skill of manifest.skills) {
    if (skill.source !== 'git') continue;
    const pin = update ? undefined : matchingPin(skill, previous?.skills[skill.name]);
    next.skills[skill.name] = await resolveGitSkill(cwd, skill, pin);
  }
  if (previous) await snapshotLock(cwd);
  await writeLock(cwd, next);
  return next;
}

export interface DiffEntry { name: string; status: 'unlocked' | 'current' | 'update-available' | 'changed-source'; locked?: string; remote?: string }

export async function diffHarness(manifest: Manifest, cwd = process.cwd()): Promise<DiffEntry[]> {
  const lock = await readLock(cwd);
  const out: DiffEntry[] = [];
  for (const skill of manifest.skills) {
    if (skill.source !== 'git') continue;
    const locked = lock?.skills[skill.name];
    if (!locked) { out.push({ name: skill.name, status: 'unlocked' }); continue; }
    if (!matchingPin(skill, locked)) { out.push({ name: skill.name, status: 'changed-source', locked: locked.resolved }); continue; }
    assertGitUrl(skill.url);
    const line = git(['ls-remote', skill.url, skill.ref]).split('\n').find(Boolean);
    const remote = line?.split(/\s+/)[0];
    out.push({ name: skill.name, status: remote === locked.resolved ? 'current' : 'update-available', locked: locked.resolved, remote });
  }
  return out;
}

export async function listSnapshots(cwd = process.cwd()): Promise<string[]> {
  const dir = resolve(cwd, HISTORY_DIR);
  if (!(await exists(dir))) return [];
  return (await readdir(dir)).filter(name => name.endsWith('.lock.json')).sort();
}

export async function rollbackHarness(manifest: Manifest, cwd = process.cwd(), snapshot?: string): Promise<string> {
  const snapshots = await listSnapshots(cwd);
  const chosen = snapshot ?? snapshots.at(-1);
  if (!chosen || !snapshots.includes(chosen)) throw new Error('No matching Harness lock snapshot found.');
  const lock = JSON.parse(await readFile(resolve(cwd, HISTORY_DIR, chosen), 'utf8')) as HarnessLock;
  for (const skill of manifest.skills) {
    if (skill.source !== 'git') continue;
    const pinned = lock.skills[skill.name];
    if (!pinned) continue;
    await resolveGitSkill(cwd, skill, pinned);
  }
  const current = await readLock(cwd);
  if (current) await snapshotLock(cwd);
  await writeLock(cwd, { ...lock, generatedAt: new Date().toISOString() });
  return chosen;
}
