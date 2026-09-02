import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { addLearning, recallLearnings, type Learning } from '../src/knowledge.js';
import { ManifestSchema, serializeManifest } from '../src/manifest.js';
import { getRecallBackend, recallBackendLines, registerRecallBackend, recallWithBackend } from '../src/recall.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function temp(prefix: string) { const root = await mkdtemp(join(tmpdir(), prefix)); roots.push(root); return root; }
async function writeManifest(root: string, recall: any) {
  await mkdir(join(root, '.agents'), { recursive: true });
  const manifest = ManifestSchema.parse({ version: 1, project: { name: 'fixture' }, runtimes: ['codex'], recall });
  await writeFile(join(root, '.agents/manifest.yaml'), serializeManifest(manifest));
}

describe('recall backends', () => {
  it('keeps lexical as the backward-compatible default', async () => {
    const root = await temp('wisedev-recall-lexical-');
    await writeManifest(root, { backend: 'lexical' });
    await addLearning('Checkout retries', 'Retry checkout only after idempotency validation', ['checkout'], root);
    const results = await recallLearnings('checkout retry', root, 5);
    expect(results[0]?.learning.title).toBe('Checkout retries');
  });

  it('uses a scope-local json index when configured and rejects path escape', async () => {
    const root = await temp('wisedev-recall-index-');
    await writeManifest(root, { backend: 'json-index', indexPath: '.agents/custom-index.json' });
    const indexed: Learning[] = [{ version: 1, id: 'one', title: 'Release safety', summary: 'Verify provenance before npm publish', tags: ['release'], createdAt: '2026-09-02T00:00:00.000Z' }];
    await writeFile(join(root, '.agents/custom-index.json'), JSON.stringify(indexed));
    const results = await recallLearnings('release provenance', root, 5);
    expect(results[0]?.file).toBe('.agents/custom-index.json#0');
    expect(results[0]?.learning.title).toBe('Release safety');

    await writeManifest(root, { backend: 'json-index', indexPath: '../outside.json' });
    await expect(recallLearnings('release', root, 5)).rejects.toThrow(/Unsafe Recall index path/);
  });

  it('exposes an in-process registry without enabling manifest-declared executable backends', async () => {
    const backendName = `test-backend-${Date.now()}`;
    registerRecallBackend({
      name: backendName,
      async search(request) {
        return [{ file: 'virtual', learning: { version: 1, id: 'v', title: request.query, summary: 'in process', tags: [], createdAt: '2026-09-02T00:00:00.000Z' }, score: 1, matched: [request.query] }];
      }
    });
    expect(getRecallBackend(backendName).name).toBe(backendName);
    const results = await recallWithBackend(backendName, { query: 'custom', cwd: process.cwd(), limit: 1 });
    expect(results[0]?.learning.title).toBe('custom');
    expect(recallBackendLines().some(line => line.startsWith(`${backendName}\t`))).toBe(true);
  });
});
