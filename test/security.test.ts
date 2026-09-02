import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { approveEvolution, evaluateEvolution, proposeEvolution } from '../src/evolution.js';
import { runHook } from '../src/hooks.js';
import { ManifestSchema, serializeManifest } from '../src/manifest.js';
import { evaluateCommandPolicy, resolveSecureProjectPath, scanSecrets } from '../src/security.js';
import { trustManifest } from '../src/trust.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function temp(prefix: string) { const path = await mkdtemp(join(tmpdir(), prefix)); roots.push(path); return path; }

async function writeManifest(root: string, value: any) {
  await mkdir(join(root, '.agents'), { recursive: true });
  const manifest = ManifestSchema.parse(value);
  await writeFile(join(root, '.agents/manifest.yaml'), serializeManifest(manifest));
  return manifest;
}

describe('security policy', () => {
  it('enforces deny rules before allow rules', () => {
    const manifest = ManifestSchema.parse({
      version: 1, project: { name: 'x' }, runtimes: ['codex'],
      policies: { execution: { allow: ['npm', 'git status'], deny: ['npm publish'], denyShellMetacharacters: false } }
    });
    expect(evaluateCommandPolicy('npm test', manifest).allowed).toBe(true);
    expect(evaluateCommandPolicy('npm publish', manifest).allowed).toBe(false);
    expect(evaluateCommandPolicy('curl https://example.com', manifest).allowed).toBe(false);
  });

  it('detects high-confidence credential patterns', () => {
    const findings = scanSecrets('password=super-secret-value\nAKIAABCDEFGHIJKLMNOP\n-----BEGIN PRIVATE KEY-----');
    expect(findings.map(item => item.kind)).toEqual(expect.arrayContaining(['credential-assignment', 'aws-access-key', 'private-key']));
  });

  it('blocks a hook denied by execution policy and records the decision', async () => {
    const root = await temp('wisedev-security-hook-');
    const manifest = await writeManifest(root, {
      version: 1, project: { name: 'fixture' }, runtimes: ['codex'],
      hooks: [{ id: 'bad', description: 'denied', event: 'Stop', command: 'rm -rf build' }],
      policies: { execution: { allow: [], deny: ['rm'], denyShellMetacharacters: false } }
    });
    await trustManifest(root);
    await expect(runHook(manifest, 'bad', root)).rejects.toThrow(/blocked/i);
    const audit = await readFile(join(root, '.agents/audit/security.jsonl'), 'utf8');
    expect(audit).toContain('"allowed":false');
  });

  it('rejects project paths that escape through a symlink', async () => {
    const root = await temp('wisedev-security-root-');
    const outside = await temp('wisedev-security-outside-');
    await symlink(outside, join(root, 'escape'));
    await expect(resolveSecureProjectPath(root, 'escape/rule.md', true)).rejects.toThrow(/symlink/i);
  });

  it('blocks secret-bearing evolution candidates before approval', async () => {
    const root = await temp('wisedev-security-evolution-');
    await writeManifest(root, { version: 1, project: { name: 'fixture' }, runtimes: ['codex'] });
    await trustManifest(root);
    const candidate = await proposeEvolution('rule.md', 'password=super-secret-value\n', 'bad candidate', undefined, root);
    await evaluateEvolution(candidate.id, 'test -s "$WISEDEV_CANDIDATE_FILE"', root);
    await expect(approveEvolution(candidate.id, root)).rejects.toThrow(/potential secrets/i);
  });
});
