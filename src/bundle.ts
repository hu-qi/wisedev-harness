import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { hashTree, readLock, SKILLS_DIR, writeLock, type HarnessLock } from './distribution.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

interface BundleFile { path: string; contentBase64: string }
interface BundleSkill { contentSha256: string; files: BundleFile[] }
interface OfflineBundle { version: 1; createdAt: string; lock: HarnessLock; skills: Record<string, BundleSkill> }

function safeRelative(path: string): string {
  const normalized = path.split('\\').join('/');
  if (!normalized || normalized.startsWith('/') || normalized === '..' || normalized.includes('../')) throw new Error(`Unsafe bundle path '${path}'.`);
  return normalized;
}

async function collectFiles(root: string): Promise<BundleFile[]> {
  const files: BundleFile[] = [];
  async function walk(path: string): Promise<void> {
    const info = await stat(path);
    if (info.isDirectory()) {
      const entries = (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.isSymbolicLink()) throw new Error(`Offline bundle refuses symbolic link '${join(path, entry.name)}'.`);
        await walk(join(path, entry.name));
      }
      return;
    }
    if (!info.isFile()) throw new Error(`Unsupported offline bundle entry '${path}'.`);
    files.push({ path: relative(root, path).split(sep).join('/'), contentBase64: (await readFile(path)).toString('base64') });
  }
  await walk(root);
  return files;
}

export async function exportOfflineBundle(output: string, cwd = process.cwd()): Promise<{ output: string; skills: number }> {
  const lock = await readLock(cwd);
  if (!lock) throw new Error('Harness lockfile is required before offline export. Run `wisedev-harness pull`.');
  const bundle: OfflineBundle = { version: 1, createdAt: new Date().toISOString(), lock, skills: {} };
  for (const [name, item] of Object.entries(lock.skills)) {
    if (!SAFE_NAME.test(name)) throw new Error(`Unsafe Skill name '${name}' in lockfile.`);
    const canonicalTarget = resolve(cwd, SKILLS_DIR, name);
    const expectedTarget = relative(cwd, canonicalTarget).split(sep).join('/');
    if (item.target !== expectedTarget) throw new Error(`Cannot export non-canonical Skill target for '${name}': ${item.target}.`);
    const actual = await hashTree(canonicalTarget);
    if (actual !== item.contentSha256) throw new Error(`Cannot export drifted Skill '${name}': expected ${item.contentSha256}, got ${actual}.`);
    bundle.skills[name] = { contentSha256: actual, files: await collectFiles(canonicalTarget) };
  }
  const target = resolve(cwd, output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, await gzipAsync(Buffer.from(JSON.stringify(bundle))));
  return { output: target, skills: Object.keys(bundle.skills).length };
}

async function materializeSkill(target: string, files: BundleFile[]): Promise<void> {
  const staging = `${target}.bundle-staging-${process.pid}-${Date.now()}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  for (const file of files) {
    const rel = safeRelative(file.path);
    const path = resolve(staging, rel);
    const root = resolve(staging);
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error(`Bundle entry escapes staging root: ${rel}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(file.contentBase64, 'base64'));
  }
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await rename(staging, target);
}

export async function importOfflineBundle(input: string, cwd = process.cwd()): Promise<{ input: string; skills: number }> {
  const source = resolve(cwd, input);
  const raw = JSON.parse((await gunzipAsync(await readFile(source))).toString('utf8')) as OfflineBundle;
  if (raw.version !== 1 || raw.lock?.version !== 1 || typeof raw.skills !== 'object') throw new Error('Unsupported or malformed WiseDev offline bundle.');

  for (const [name, locked] of Object.entries(raw.lock.skills)) {
    if (!SAFE_NAME.test(name)) throw new Error(`Unsafe Skill name '${name}' in offline bundle.`);
    const skill = raw.skills[name];
    if (!skill) throw new Error(`Offline bundle is missing Skill '${name}'.`);
    if (skill.contentSha256 !== locked.contentSha256) throw new Error(`Offline bundle metadata mismatch for Skill '${name}'.`);
    const target = resolve(cwd, SKILLS_DIR, name);
    const canonicalTarget = relative(cwd, target).split(sep).join('/');
    if (locked.target !== canonicalTarget) throw new Error(`Offline bundle target mismatch for Skill '${name}': expected ${canonicalTarget}, got ${locked.target}.`);
    await materializeSkill(target, skill.files);
    const actual = await hashTree(target);
    if (actual !== locked.contentSha256) throw new Error(`Offline bundle integrity failure for Skill '${name}': expected ${locked.contentSha256}, got ${actual}.`);
  }
  await writeLock(cwd, { ...raw.lock, generatedAt: new Date().toISOString() });
  return { input: source, skills: Object.keys(raw.lock.skills).length };
}
