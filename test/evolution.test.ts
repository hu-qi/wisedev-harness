import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { applyEvolution, approveEvolution, evaluateEvolution, proposeEvolution, rollbackEvolution } from '../src/evolution.js';
import { ManifestSchema, serializeManifest } from '../src/manifest.js';
import { trustManifest } from '../src/trust.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'wisedev-evolution-')); roots.push(root);
  await mkdir(join(root, '.agents'), { recursive: true });
  const manifest = ManifestSchema.parse({ version: 1, project: { name: 'fixture' }, runtimes: ['codex'] });
  await writeFile(join(root, '.agents/manifest.yaml'), serializeManifest(manifest));
  await trustManifest(root);
  return root;
}

const candidateContains = (value: string) => `node -e "process.exit(require('fs').readFileSync(process.env.WISEDEV_CANDIDATE_FILE,'utf8').includes('${value}')?0:1)"`;
const candidateNonEmpty = `node -e "process.exit(require('fs').statSync(process.env.WISEDEV_CANDIDATE_FILE).size>0?0:1)"`;

describe('controlled evolution', () => {
  it('requires passing eval, applies against unchanged baseline, and rolls back exactly', async () => {
    const cwd = await fixture();
    await writeFile(join(cwd, 'rule.md'), 'old\n');
    const candidate = await proposeEvolution('rule.md', 'new\n', 'improve rule', undefined, cwd);
    await expect(approveEvolution(candidate.id, cwd)).rejects.toThrow(/passing evaluation/i);
    const evaluation = await evaluateEvolution(candidate.id, candidateContains('new'), cwd);
    expect(evaluation.passed).toBe(true);
    await approveEvolution(candidate.id, cwd);
    await applyEvolution(candidate.id, cwd);
    expect(await readFile(join(cwd, 'rule.md'), 'utf8')).toBe('new\n');
    await rollbackEvolution(candidate.id, cwd);
    expect(await readFile(join(cwd, 'rule.md'), 'utf8')).toBe('old\n');
  });

  it('refuses stale candidates if target changed after proposal', async () => {
    const cwd = await fixture();
    await writeFile(join(cwd, 'rule.md'), 'base\n');
    const candidate = await proposeEvolution('rule.md', 'candidate\n', 'change rule', undefined, cwd);
    await evaluateEvolution(candidate.id, candidateNonEmpty, cwd);
    await approveEvolution(candidate.id, cwd);
    await writeFile(join(cwd, 'rule.md'), 'someone else changed it\n');
    await expect(applyEvolution(candidate.id, cwd)).rejects.toThrow(/Target changed since proposal/);
  });

  it('removes a newly created target on rollback', async () => {
    const cwd = await fixture();
    const candidate = await proposeEvolution('new-rule.md', 'created\n', 'new rule', undefined, cwd);
    await evaluateEvolution(candidate.id, candidateContains('created'), cwd);
    await approveEvolution(candidate.id, cwd);
    await applyEvolution(candidate.id, cwd);
    expect(await readFile(join(cwd, 'new-rule.md'), 'utf8')).toBe('created\n');
    await rollbackEvolution(candidate.id, cwd);
    await expect(readFile(join(cwd, 'new-rule.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
