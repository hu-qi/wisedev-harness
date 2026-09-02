import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { injectHooks, removeHooks, runHook } from '../src/hooks.js';
import { ManifestSchema, serializeManifest } from '../src/manifest.js';
import { isManifestTrusted, trustManifest } from '../src/trust.js';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'wisedev-hooks-'));
  roots.push(root);
  await mkdir(join(root, '.agents'), { recursive: true });
  const manifest = ManifestSchema.parse({
    version: 1,
    project: { name: 'fixture' },
    runtimes: ['claude', 'codex', 'cursor'],
    hooks: [{ id: 'record', description: 'record execution', event: 'Stop', command: 'printf hook-ok > .agents/hook-output.txt' }]
  });
  await writeFile(join(root, '.agents/manifest.yaml'), serializeManifest(manifest));
  return { root, manifest };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('hook trust and reconciliation', () => {
  it('preserves unmanaged runtime hooks while reconciling managed hooks', async () => {
    const { root, manifest } = await fixture();
    await mkdir(join(root, '.claude'), { recursive: true });
    await writeFile(join(root, '.claude/settings.json'), JSON.stringify({ hooks: { Stop: [{ matcher: '*', description: 'user hook', hooks: [{ type: 'command', command: 'echo user' }] }] } }));

    await injectHooks(manifest, root);
    const claude = JSON.parse(await readFile(join(root, '.claude/settings.json'), 'utf8'));
    expect(claude.hooks.Stop.some((entry: any) => entry.description === 'user hook')).toBe(true);
    expect(claude.hooks.Stop.some((entry: any) => entry.hooks?.[0]?.command === 'wisedev-harness hook-run record')).toBe(true);

    const cursor = JSON.parse(await readFile(join(root, '.cursor/hooks.json'), 'utf8'));
    expect(cursor.hooks.stop.some((entry: any) => entry.command === 'wisedev-harness hook-run record')).toBe(true);

    await removeHooks(manifest, root);
    const cleaned = JSON.parse(await readFile(join(root, '.claude/settings.json'), 'utf8'));
    expect(cleaned.hooks.Stop).toHaveLength(1);
    expect(cleaned.hooks.Stop[0].description).toBe('user hook');
  });

  it('invalidates trust whenever manifest bytes change', async () => {
    const { root } = await fixture();
    expect(await isManifestTrusted(root)).toBe(false);
    await trustManifest(root);
    expect(await isManifestTrusted(root)).toBe(true);
    await writeFile(join(root, '.agents/manifest.yaml'), `${await readFile(join(root, '.agents/manifest.yaml'), 'utf8')}\n# changed\n`);
    expect(await isManifestTrusted(root)).toBe(false);
  });

  it('refuses untrusted hook execution and runs only after explicit trust', async () => {
    const { root, manifest } = await fixture();
    await expect(runHook(manifest, 'record', root)).rejects.toThrow(/not trusted/i);
    await trustManifest(root);
    expect(await runHook(manifest, 'record', root)).toBe(0);
    expect(await readFile(join(root, '.agents/hook-output.txt'), 'utf8')).toBe('hook-ok');
  });
});
