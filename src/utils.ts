import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HarnessError } from './errors.js';
import type { HarnessState } from './types.js';
import { STATE_PATH } from './constants.js';

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function normalizeRelative(input: string): string {
  return input.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function resolveInside(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new HarnessError('PATH_OUTSIDE_PROJECT', `Absolute paths are not allowed: ${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const prefix = `${resolvedRoot}${path.sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) {
    throw new HarnessError('PATH_OUTSIDE_PROJECT', `Path escapes project root: ${relativePath}`);
  }
  return resolved;
}

export async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function readUtf8(target: string): Promise<string> {
  return readFile(target, 'utf8');
}

export async function writeAtomic(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.wisedev-tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, target);
}

export async function removeFile(target: string): Promise<void> {
  await rm(target, { force: true });
}

export interface SourceFile {
  relativePath: string;
  absolutePath: string;
  content: string;
}

export async function listSourceFiles(root: string, relativeRoot: string): Promise<SourceFile[]> {
  const absoluteRoot = resolveInside(root, relativeRoot);
  if (!(await exists(absoluteRoot))) return [];

  const rootStat = await lstat(absoluteRoot);
  if (rootStat.isSymbolicLink()) {
    throw new HarnessError('SYMLINK_SOURCE_REJECTED', `Resource root cannot be a symlink: ${relativeRoot}`);
  }
  if (!rootStat.isDirectory()) {
    throw new HarnessError('RESOURCE_ROOT_NOT_DIRECTORY', `Resource root is not a directory: ${relativeRoot}`);
  }

  const output: SourceFile[] = [];

  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        throw new HarnessError('SYMLINK_SOURCE_REJECTED', `Symlink resources are not followed: ${normalizeRelative(path.join(relativeRoot, relative))}`);
      }
      if (entry.isDirectory()) {
        await visit(absolute, relative);
      } else if (entry.isFile()) {
        output.push({ relativePath: normalizeRelative(relative), absolutePath: absolute, content: await readUtf8(absolute) });
      }
    }
  }

  await visit(absoluteRoot, '');
  return output;
}

export async function readState(root: string): Promise<HarnessState | null> {
  const target = resolveInside(root, STATE_PATH);
  if (!(await exists(target))) return null;
  try {
    const parsed: unknown = JSON.parse(await readUtf8(target));
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<HarnessState>;
    if (candidate.version !== 1 || !Array.isArray(candidate.managed) || typeof candidate.manifestHash !== 'string') return null;
    return candidate as HarnessState;
  } catch {
    return null;
  }
}

export async function writeState(root: string, state: HarnessState): Promise<void> {
  await writeAtomic(resolveInside(root, STATE_PATH), `${JSON.stringify(state, null, 2)}\n`);
}

export function relativeToRoot(root: string, target: string): string {
  return normalizeRelative(path.relative(path.resolve(root), target));
}
