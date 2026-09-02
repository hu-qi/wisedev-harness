import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { initHarness } from '../src/core.js';
import { ManifestSchema, serializeManifest } from '../src/manifest.js';
import { loadEffectiveManifest, loadManifestForScope, saveProfile, userScopeRoot } from '../src/team.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function temp(prefix: string) { const root = await mkdtemp(join(tmpdir(), prefix)); roots.push(root); return root; }

async function writeManifest(root: string, value: unknown) {
  await mkdir(join(root, '.agents'), { recursive: true });
  const manifest = ManifestSchema.parse(value);
  await writeFile(join(root, '.agents/manifest.yaml'), serializeManifest(manifest));
  return manifest;
}

describe('scope and team resource resolution', () => {
  it('keeps old manifests backward compatible as project scope', () => {
    const manifest = ManifestSchema.parse({ version: 1, project: { name: 'legacy' }, runtimes: ['codex'] });
    expect(manifest.scope).toBe('project');
    expect(manifest.inheritUserScope).toBe(false);
    expect(manifest.sources).toEqual([]);
  });

  it('layers safe user resources, applies profile filters, and keeps execution resources project-owned', async () => {
    const project = await temp('wisedev-team-project-');
    const home = await temp('wisedev-team-home-');
    const userRoot = userScopeRoot(home);

    await writeManifest(userRoot, {
      version: 1,
      scope: 'user',
      project: { name: 'engineering' },
      runtimes: ['codex'],
      sources: [{ name: 'team', url: 'https://example.com/user-team.git', ref: 'main' }],
      skills: [
        { name: 'user-frontend', source: 'local', path: '.agents/skills/user-frontend', roles: ['frontend'] },
        { name: 'tag-only', source: 'local', path: '.agents/skills/tag-only', tags: ['platform'] },
        { name: 'same', source: 'local', path: '.agents/skills/user-same' },
        { name: 'user-shared', source: 'shared', sourceName: 'team', path: 'skills/user-shared' }
      ],
      rules: [{ path: '.agents/rules/team.md', required: true }],
      hooks: [{ id: 'user-danger', description: 'must not inherit', event: 'Stop', command: 'curl https://example.com' }],
      policies: { execution: { allow: ['curl'], deny: [], denyShellMetacharacters: false } }
    });
    await saveProfile(userRoot, { roles: ['frontend'], tags: [] });

    await writeManifest(project, {
      version: 1,
      scope: 'project',
      inheritUserScope: true,
      project: { name: 'app' },
      runtimes: ['codex'],
      sources: [{ name: 'team', url: 'https://example.com/project-team.git', ref: 'stable' }],
      skills: [
        { name: 'same', source: 'local', path: '.agents/skills/project-same' },
        { name: 'project-only', source: 'local', path: '.agents/skills/project-only', tags: ['project-tag'] }
      ],
      hooks: [{ id: 'project-hook', description: 'project owned', event: 'Stop', command: 'npm test' }],
      policies: { execution: { allow: ['npm'], deny: ['npm publish'], denyShellMetacharacters: false } }
    });
    await saveProfile(project, { roles: [], tags: ['project-tag'] });

    const result = await loadEffectiveManifest(project, home);
    const byName = new Map(result.manifest.skills.map(skill => [skill.name, skill]));

    expect(result.profile).toEqual({ roles: ['frontend'], tags: ['project-tag'] });
    expect([...byName.keys()].sort()).toEqual(['project-only', 'same', 'user-frontend', 'user-shared'].sort());
    expect(byName.has('tag-only')).toBe(false);
    expect(byName.get('same')).toMatchObject({ source: 'local', path: '.agents/skills/project-same' });
    expect(byName.get('user-frontend')?.path).toBe(join(userRoot, '.agents/skills/user-frontend'));
    expect(result.manifest.sources).toEqual([{ name: 'team', url: 'https://example.com/project-team.git', ref: 'stable', required: true }]);

    expect(result.manifest.hooks.map(hook => hook.id)).toEqual(['project-hook']);
    expect(result.manifest.policies.execution.allow).toEqual(['npm']);
    expect(result.manifest.rules[0].path).toBe(join(userRoot, '.agents/rules/team.md'));

    const skipped = result.entries.find(entry => entry.kind === 'skill' && entry.name === 'tag-only');
    expect(skipped).toMatchObject({ selected: false, origin: 'user' });
    expect(skipped?.reason).toMatch(/tag mismatch/);
  });

  it('initializes user scope without creating runtime instruction files and keeps profile local', async () => {
    const home = await temp('wisedev-team-init-home-');
    const root = userScopeRoot(home);
    await initHarness(root, false, { scope: 'user', applyRuntimeAdapters: false });
    await saveProfile(root, { roles: ['frontend'], tags: ['web'] });

    const { manifest } = await loadManifestForScope('user', home, home);
    expect(manifest.scope).toBe('user');
    await expect(readFile(join(root, 'AGENTS.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'CLAUDE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(root, '.agents/.gitignore'), 'utf8')).toContain('profile.yaml');
  });
});
