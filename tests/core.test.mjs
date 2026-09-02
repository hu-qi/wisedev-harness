import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkProject, initProject, planProject, syncProject, verifyProject } from '../dist/index.js';

async function fixture(agents = ['claude', 'codex']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wisedev-harness-'));
  await initProject(root, { agents });
  await mkdir(path.join(root, '.agents/skills/demo'), { recursive: true });
  await mkdir(path.join(root, '.agents/rules'), { recursive: true });
  await writeFile(path.join(root, '.agents/skills/demo/SKILL.md'), '# Demo Skill\n\nDo the demo safely.\n');
  await writeFile(path.join(root, '.agents/rules/project.md'), '# Project rules\n\n- Do not rewrite unrelated files.\n');
  return root;
}

async function doesNotExist(target) {
  try {
    await access(target);
    return false;
  } catch {
    return true;
  }
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

test('plan computes changes without writing targets or state', async () => {
  const root = await fixture(['claude']);
  try {
    const result = await planProject(root);
    assert.equal(result.changed, true);
    assert.equal(result.diagnostics.some((item) => item.level === 'error'), false);
    assert.equal(result.operations.some((item) => item.type === 'write'), true);
    assert.equal(await doesNotExist(path.join(root, '.claude/skills/demo/SKILL.md')), true);
    assert.equal(await doesNotExist(path.join(root, '.agents/state.json')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Cursor adapter writes skills and valid mdc rules', async () => {
  const root = await fixture(['cursor']);
  try {
    const result = await syncProject(root);
    assert.equal(result.diagnostics.some((item) => item.level === 'error'), false);
    assert.match(await readFile(path.join(root, '.cursor/skills/demo/SKILL.md'), 'utf8'), /Demo Skill/);
    const rule = await readFile(path.join(root, '.cursor/rules/wisedev/project.mdc'), 'utf8');
    assert.match(rule, /^---\n/);
    assert.match(rule, /alwaysApply: true/);
    assert.match(rule, /Project rules/);
    assert.equal(await doesNotExist(path.join(root, '.cursor/rules/wisedev/project.md')), true);
    assert.equal((await verifyProject(root)).ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('OpenCode adapter activates and removes only the WiseDev instruction glob', async () => {
  const root = await fixture(['opencode']);
  try {
    await writeFile(path.join(root, 'opencode.json'), `${JSON.stringify({ theme: 'dark', instructions: ['README.md'], mcp: { demo: { enabled: true } } }, null, 2)}\n`);

    const first = await syncProject(root);
    assert.equal(first.diagnostics.some((item) => item.level === 'error'), false, JSON.stringify(first.diagnostics, null, 2));
    assert.match(await readFile(path.join(root, '.opencode/skills/demo/SKILL.md'), 'utf8'), /Demo Skill/);
    assert.match(await readFile(path.join(root, '.opencode/rules/wisedev/project.md'), 'utf8'), /Project rules/);

    const config = JSON.parse(await readFile(path.join(root, 'opencode.json'), 'utf8'));
    assert.equal(config.theme, 'dark');
    assert.deepEqual(config.mcp, { demo: { enabled: true } });
    assert.deepEqual(config.instructions, ['README.md', '.opencode/rules/wisedev/**/*.md']);
    assert.equal((await verifyProject(root)).ok, true);

    await unlink(path.join(root, '.agents/rules/project.md'));
    const second = await syncProject(root);
    assert.equal(second.diagnostics.some((item) => item.level === 'error'), false, JSON.stringify(second.diagnostics, null, 2));
    assert.equal(await doesNotExist(path.join(root, '.opencode/rules/wisedev/project.md')), true);

    const afterRemoval = JSON.parse(await readFile(path.join(root, 'opencode.json'), 'utf8'));
    assert.equal(afterRemoval.theme, 'dark');
    assert.deepEqual(afterRemoval.mcp, { demo: { enabled: true } });
    assert.deepEqual(afterRemoval.instructions, ['README.md']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('OpenCode invalid config fails closed before managed target writes', async () => {
  const root = await fixture(['opencode']);
  try {
    await writeFile(path.join(root, 'opencode.json'), '{ broken json');
    const result = await syncProject(root);
    assert.equal(result.changed, false);
    assert.equal(result.diagnostics.some((item) => item.code === 'OPENCODE_CONFIG_INVALID'), true);
    assert.equal(await doesNotExist(path.join(root, '.opencode/skills/demo/SKILL.md')), true);
    assert.equal(await doesNotExist(path.join(root, '.opencode/rules/wisedev/project.md')), true);
    assert.equal(await doesNotExist(path.join(root, '.agents/state.json')), true);
    assert.equal(await readFile(path.join(root, 'opencode.json'), 'utf8'), '{ broken json');
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
