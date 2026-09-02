import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { MANIFEST_PATH } from './manifest.js';

export const TRUST_PATH = '.agents/trust.json';

export interface TrustRecord {
  version: 1;
  manifestSha256: string;
  trustedAt: string;
}

export async function manifestFingerprint(cwd = process.cwd()): Promise<string> {
  const raw = await readFile(resolve(cwd, MANIFEST_PATH));
  return createHash('sha256').update(raw).digest('hex');
}

export async function readTrust(cwd = process.cwd()): Promise<TrustRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(resolve(cwd, TRUST_PATH), 'utf8')) as TrustRecord;
    if (parsed.version !== 1 || typeof parsed.manifestSha256 !== 'string') return null;
    return parsed;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function isManifestTrusted(cwd = process.cwd()): Promise<boolean> {
  const trust = await readTrust(cwd);
  if (!trust) return false;
  return trust.manifestSha256 === await manifestFingerprint(cwd);
}

export async function trustManifest(cwd = process.cwd()): Promise<TrustRecord> {
  const record: TrustRecord = { version: 1, manifestSha256: await manifestFingerprint(cwd), trustedAt: new Date().toISOString() };
  const path = resolve(cwd, TRUST_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  return record;
}

export async function revokeTrust(cwd = process.cwd()): Promise<void> {
  await rm(resolve(cwd, TRUST_PATH), { force: true });
}
