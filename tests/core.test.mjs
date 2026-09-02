import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkProject, initProject, syncProject, verifyProject } from '../dist/index.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wisedev-harness-'));
  await initProject(root, { agents: ['claude', 'codex'] });
  await mkdir(path.join(root, '.agents/skills/demo'), { recursive: true });
  await mkdir(path.join(root, '.agents/rules'), { recursive: true });
  await writeFile(path.join(root, '.agents/skills/demo/SKILL.md'), '# Demo Skill\n\nDo the demo safely.\n');
  await writeFile(path.join(root, '.agents/rules/project.md'), '# Project rules\n\n- Do not rewrite unrelated files.\n');
  return root;
}

test('init, sync and verify create deterministic managed resources', async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, 'AGENTS.md'), '# User instructions\n\nKeep this text.\n');
    const check = await checkProject(root);
    assert.equal(check.some((item) => item.level === 'error'), false);

    const sync = await syncProject(root);
    assert.equal(sync.diagnostics.some((item) => item.level === 'error'), false);
    assert.equal(sync.changed, true);

    assert.match(await readFile(path.join(root, '.claude/skills/demo/SKILL.md'), 'utf8'), /Demo Skill/);
    assert.match(await readFile(path.join(root, '.codex/skills/demo/SKILL.md'), 'utf8'), /Demo Skill/);
    assert.match(await readFile(path.join(root, '.claude/rules/wisedev/project.md'), 'utf8'), /Project rules/);

    const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
    assert.match(agents, /# User instructions/);
    assert.match(agents, /wisedev-harness:rules:start/);
    assert.match(agents, /Project rules/);

    const verify = await verifyProject(root);
    assert.equal(verify.ok, true, JSON.stringify(verify.diagnostics, null, 2));

    const secondSync = await syncProject(root);
    assert.equal(secondSync.changed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('sync refuses to overwrite a locally modified managed file', async () => {
  const root = await fixture();
  try {
    await syncProject(root);
    const managed = path.join(root, '.claude/skills/demo/SKILL.md');
    await writeFile(managed, '# Local edit\n');

    const result = await syncProject(root);
    assert.equal(result.changed, false);
    assert.equal(result.diagnostics.some((item) => item.code === 'MANAGED_TARGET_CONFLICT'), true);
    assert.equal(await readFile(managed, 'utf8'), '# Local edit\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verify detects managed target drift without repairing it', async () => {
  const root = await fixture();
  try {
    await syncProject(root);
    const managed = path.join(root, '.codex/skills/demo/SKILL.md');
    await writeFile(managed, '# Drifted\n');

    const result = await verifyProject(root);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics.some((item) => item.code === 'MANAGED_TARGET_DRIFT'), true);
    assert.equal(await readFile(managed, 'utf8'), '# Drifted\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
