import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { exportOfflineBundle, importOfflineBundle } from '../src/bundle.js';
import { hashTree, readLock, writeLock } from '../src/distribution.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function temp(prefix: string) { const root = await mkdtemp(join(tmpdir(), prefix)); roots.push(root); return root; }

async function fixture(root: string) {
  const skillRoot = join(root, '.agents/skills/foo');
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, 'SKILL.md'), '# Foo\nverified content\n');
  const contentSha256 = await hashTree(skillRoot);
  await writeLock(root, {
    version: 1,
    generatedAt: new Date().toISOString(),
    skills: {
      foo: {
        source: 'git',
        url: 'https://example.com/foo.git',
        ref: 'main',
        resolved: '0123456789abcdef0123456789abcdef01234567',
        contentSha256,
        target: '.agents/skills/foo'
      }
    }
  });
  return { skillRoot, contentSha256 };
}

describe('offline bundles', () => {
  it('round-trips exact lock-pinned Skill content without network access', async () => {
    const root = await temp('wisedev-bundle-');
    const { skillRoot, contentSha256 } = await fixture(root);
    const bundle = join(root, 'offline.wdh.gz');

    expect((await exportOfflineBundle('offline.wdh.gz', root)).skills).toBe(1);
    await rm(join(root, '.agents/skills'), { recursive: true, force: true });
    await rm(join(root, '.agents/harness.lock.json'), { force: true });

    expect((await importOfflineBundle('offline.wdh.gz', root)).skills).toBe(1);
    expect(await readFile(join(skillRoot, 'SKILL.md'), 'utf8')).toBe('# Foo\nverified content\n');
    expect((await readLock(root))?.skills.foo.contentSha256).toBe(contentSha256);
  });

  it('rejects a forged lock target instead of writing outside the canonical Skills root', async () => {
    const root = await temp('wisedev-bundle-target-');
    await fixture(root);
    await exportOfflineBundle('offline.wdh.gz', root);
    const raw = JSON.parse((await gunzipAsync(await readFile(join(root, 'offline.wdh.gz')))).toString('utf8'));
    raw.lock.skills.foo.target = '../../escape';
    await writeFile(join(root, 'forged.wdh.gz'), await gzipAsync(Buffer.from(JSON.stringify(raw))));

    await expect(importOfflineBundle('forged.wdh.gz', root)).rejects.toThrow(/target mismatch/i);
  });

  it('verifies staged content before replacing a currently valid Skill', async () => {
    const root = await temp('wisedev-bundle-tamper-');
    const { skillRoot } = await fixture(root);
    await exportOfflineBundle('offline.wdh.gz', root);
    const raw = JSON.parse((await gunzipAsync(await readFile(join(root, 'offline.wdh.gz')))).toString('utf8'));
    raw.skills.foo.files[0].contentBase64 = Buffer.from('# Foo\ntampered\n').toString('base64');
    await writeFile(join(root, 'tampered.wdh.gz'), await gzipAsync(Buffer.from(JSON.stringify(raw))));

    await expect(importOfflineBundle('tampered.wdh.gz', root)).rejects.toThrow(/hash mismatch/i);
    expect(await readFile(join(skillRoot, 'SKILL.md'), 'utf8')).toBe('# Foo\nverified content\n');
  });
});
