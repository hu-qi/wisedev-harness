import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { addLearning, endSession, listLearningCandidates, promoteLearning, recallLearnings, recordSessionEvent, redactText, startSession } from '../src/knowledge.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function root() { const value = await mkdtemp(join(tmpdir(), 'wisedev-knowledge-')); roots.push(value); return value; }

describe('knowledge loop', () => {
  it('redacts common secret shapes', () => {
    const text = redactText('Authorization: Bearer abc123 token=secret-value password=hunter2 sk-abcdefghijklmnop');
    expect(text).not.toContain('abc123');
    expect(text).not.toContain('secret-value');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('sk-abcdefghijklmnop');
  });

  it('scores friction and creates a reviewable candidate', async () => {
    const cwd = await root();
    const session = await startSession('fix deployment token=do-not-store', cwd);
    await recordSessionEvent('intervention', 'user corrected the rollout plan', cwd);
    await recordSessionEvent('tool_failure', 'deploy command failed password=secret', cwd);
    const result = await endSession(cwd, 5);
    expect(result.summary.frictionScore).toBe(5);
    expect(result.candidate?.id).toBe(session.id);
    const candidates = await listLearningCandidates(cwd);
    expect(candidates).toHaveLength(1);
    expect(JSON.stringify(candidates)).not.toContain('do-not-store');
    expect(JSON.stringify(candidates)).not.toContain('password=secret');

    const file = await promoteLearning(candidates[0].id, 'Deployment rollback', 'Check rollout health before promotion', ['deploy', 'rollback'], cwd);
    const raw = await readFile(join(cwd, '.agents/learnings', file), 'utf8');
    expect(raw).toContain('Deployment rollback');
  });

  it('returns explainable ranked recall results', async () => {
    const cwd = await root();
    await addLearning('Port conflict recovery', 'Check the bound process before changing application ports.', ['networking', 'debug'], cwd);
    await addLearning('Release checklist', 'Run typecheck and tests before publishing.', ['release'], cwd);
    const results = await recallLearnings('port networking', cwd);
    expect(results[0].learning.title).toBe('Port conflict recovery');
    expect(results[0].matched).toEqual(expect.arrayContaining(['port', 'networking']));
    expect(results[0].score).toBeGreaterThan(0);
  });
});
