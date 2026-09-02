import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { diffHarness, listSnapshots, pullHarness, rollbackHarness } from '../src/distribution.js';
import { ManifestSchema } from '../src/manifest.js';

const roots: string[] = [];
function git(cwd: string, ...args: string[]) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }

async function commitVersion(repo: string, version: string) {
  const skillDir = join(repo, 'skills', 'demo');
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), `# Demo\n\n${version}\n`);
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', version);
  return git(repo, 'rev-parse', 'HEAD');
}

afterEach(async () => {
  delete process.env.WISEDEV_HARNESS_ALLOW_FILE_GIT;
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('git distribution lifecycle', () => {
  it('keeps pull pinned, updates explicitly, then rolls back', async () => {
    process.env.WISEDEV_HARNESS_ALLOW_FILE_GIT = '1';
    const source = await mkdtemp(join(tmpdir(), 'wisedev-source-'));
    const project = await mkdtemp(join(tmpdir(), 'wisedev-project-'));
    roots.push(source, project);
    git(source, 'init', '-b', 'main');
    git(source, 'config', 'user.email', 'test@example.com');
    git(source, 'config', 'user.name', 'WiseDev Test');
    const first = await commitVersion(source, 'v1');

    const manifest = ManifestSchema.parse({
      version: 1,
      project: { name: 'fixture' },
      runtimes: ['codex'],
      skills: [{ name: 'demo', source: 'git', url: pathToFileURL(source).href, ref: 'main', path: 'skills/demo', required: true }]
    });

    const initial = await pullHarness(manifest, project);
    expect(initial.skills.demo.resolved).toBe(first);
    expect(await readFile(join(project, '.agents/skills/demo/SKILL.md'), 'utf8')).toContain('v1');

    const second = await commitVersion(source, 'v2');
    const pinned = await pullHarness(manifest, project);
    expect(pinned.skills.demo.resolved).toBe(first);
    expect(await readFile(join(project, '.agents/skills/demo/SKILL.md'), 'utf8')).toContain('v1');

    const diff = await diffHarness(manifest, project);
    expect(diff[0]).toMatchObject({ status: 'update-available', locked: first, remote: second });

    const updated = await pullHarness(manifest, project, true);
    expect(updated.skills.demo.resolved).toBe(second);
    expect(await readFile(join(project, '.agents/skills/demo/SKILL.md'), 'utf8')).toContain('v2');

    const snapshots = await listSnapshots(project);
    expect(snapshots.length).toBeGreaterThan(0);
    await rollbackHarness(manifest, project, snapshots.at(-1));
    expect(await readFile(join(project, '.agents/skills/demo/SKILL.md'), 'utf8')).toContain('v1');
  });

  it('resolves a shared source alias into the same reproducible lock semantics', async () => {
    process.env.WISEDEV_HARNESS_ALLOW_FILE_GIT = '1';
    const source = await mkdtemp(join(tmpdir(), 'wisedev-shared-source-'));
    const project = await mkdtemp(join(tmpdir(), 'wisedev-shared-project-'));
    roots.push(source, project);
    git(source, 'init', '-b', 'main');
    git(source, 'config', 'user.email', 'test@example.com');
    git(source, 'config', 'user.name', 'WiseDev Test');
    const first = await commitVersion(source, 'shared-v1');

    const manifest = ManifestSchema.parse({
      version: 1,
      project: { name: 'fixture' },
      runtimes: ['codex'],
      sources: [{ name: 'team', url: pathToFileURL(source).href, ref: 'main' }],
      skills: [{ name: 'demo', source: 'shared', sourceName: 'team', path: 'skills/demo' }]
    });

    const lock = await pullHarness(manifest, project);
    expect(lock.skills.demo).toMatchObject({ source: 'git', sourceName: 'team', resolved: first, path: 'skills/demo' });
    expect(await readFile(join(project, '.agents/skills/demo/SKILL.md'), 'utf8')).toContain('shared-v1');

    await commitVersion(source, 'shared-v2');
    const pinned = await pullHarness(manifest, project);
    expect(pinned.skills.demo.resolved).toBe(first);
    expect((await diffHarness(manifest, project))[0].status).toBe('update-available');
  });
});
