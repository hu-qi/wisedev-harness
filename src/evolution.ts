import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { isManifestTrusted } from './trust.js';
import { redactText } from './knowledge.js';

const CANDIDATE_DIR = '.agents/evolution-candidates';
const BACKUP_DIR = '.agents/evolution-backups';

export interface EvolutionEval {
  at: string;
  command: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface EvolutionCandidate {
  version: 1;
  id: string;
  target: string;
  reason: string;
  sourceLearning?: string;
  baseSha256: string;
  proposedContent: string;
  createdAt: string;
  status: 'proposed' | 'approved' | 'applied' | 'rolled_back';
  evaluations: EvolutionEval[];
  approvedAt?: string;
  appliedAt?: string;
  rolledBackAt?: string;
}

function hash(content: string): string { return createHash('sha256').update(content).digest('hex'); }

function resolveTarget(cwd: string, target: string): string {
  if (!target || target.startsWith('/') || target.includes('../') || target.includes('\\..\\') || target === '..') throw new Error(`Unsafe evolution target '${target}'.`);
  if (target === '.git' || target.startsWith('.git/') || target.startsWith('.agents/evolution-')) throw new Error(`Protected evolution target '${target}'.`);
  const root = resolve(cwd);
  const absolute = resolve(root, target);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) throw new Error(`Target escapes project root: ${target}`);
  return absolute;
}

async function readOptional(path: string): Promise<string> {
  try { return await readFile(path, 'utf8'); }
  catch (error: any) { if (error?.code === 'ENOENT') return ''; throw error; }
}

function candidatePath(cwd: string, id: string): string { return resolve(cwd, CANDIDATE_DIR, `${id}.json`); }
function backupPath(cwd: string, id: string): string { return resolve(cwd, BACKUP_DIR, `${id}.txt`); }

async function writeCandidate(cwd: string, candidate: EvolutionCandidate): Promise<void> {
  await mkdir(resolve(cwd, CANDIDATE_DIR), { recursive: true });
  await writeFile(candidatePath(cwd, candidate.id), JSON.stringify(candidate, null, 2) + '\n');
}

export async function readEvolutionCandidate(id: string, cwd = process.cwd()): Promise<EvolutionCandidate> {
  return JSON.parse(await readFile(candidatePath(cwd, id), 'utf8')) as EvolutionCandidate;
}

export async function proposeEvolution(target: string, proposedContent: string, reason: string, sourceLearning?: string, cwd = process.cwd()): Promise<EvolutionCandidate> {
  const absolute = resolveTarget(cwd, target);
  const base = await readOptional(absolute);
  const candidate: EvolutionCandidate = {
    version: 1,
    id: randomUUID(),
    target,
    reason: redactText(reason),
    ...(sourceLearning ? { sourceLearning } : {}),
    baseSha256: hash(base),
    proposedContent,
    createdAt: new Date().toISOString(),
    status: 'proposed',
    evaluations: []
  };
  await writeCandidate(cwd, candidate);
  return candidate;
}

export function evolutionDiff(candidate: EvolutionCandidate, currentContent: string): { baselineLines: number; candidateLines: number; changedLineCount: number; baseMatchesCurrent: boolean } {
  const before = currentContent.split('\n');
  const after = candidate.proposedContent.split('\n');
  const max = Math.max(before.length, after.length);
  let changed = 0;
  for (let i = 0; i < max; i += 1) if (before[i] !== after[i]) changed += 1;
  return { baselineLines: before.length, candidateLines: after.length, changedLineCount: changed, baseMatchesCurrent: hash(currentContent) === candidate.baseSha256 };
}

export async function evaluateEvolution(id: string, command: string, cwd = process.cwd()): Promise<EvolutionEval> {
  if (!(await isManifestTrusted(cwd))) throw new Error('Evolution eval commands require a trusted current manifest.');
  const candidate = await readEvolutionCandidate(id, cwd);
  if (candidate.status !== 'proposed') throw new Error(`Candidate '${id}' is ${candidate.status}; only proposed candidates can be evaluated.`);
  const target = resolveTarget(cwd, candidate.target);
  const scratchDir = resolve(cwd, '.agents/evolution-eval', id);
  await mkdir(scratchDir, { recursive: true });
  const candidateFile = resolve(scratchDir, 'candidate.txt');
  await writeFile(candidateFile, candidate.proposedContent);
  const result = spawnSync('sh', ['-lc', command], {
    cwd,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, WISEDEV_EVOLUTION_ID: id, WISEDEV_CANDIDATE_FILE: candidateFile, WISEDEV_TARGET_FILE: target }
  });
  const record: EvolutionEval = {
    at: new Date().toISOString(), command: redactText(command), passed: !result.error && result.status === 0,
    exitCode: result.status ?? 1,
    stdout: redactText(String(result.stdout ?? '')).slice(-8000),
    stderr: redactText(String(result.stderr ?? result.error?.message ?? '')).slice(-8000)
  };
  candidate.evaluations.push(record);
  await writeCandidate(cwd, candidate);
  return record;
}

export async function approveEvolution(id: string, cwd = process.cwd()): Promise<EvolutionCandidate> {
  const candidate = await readEvolutionCandidate(id, cwd);
  if (candidate.status !== 'proposed') throw new Error(`Candidate '${id}' is ${candidate.status}.`);
  if (!candidate.evaluations.some(item => item.passed)) throw new Error('At least one passing evaluation is required before approval.');
  candidate.status = 'approved'; candidate.approvedAt = new Date().toISOString();
  await writeCandidate(cwd, candidate); return candidate;
}

export async function applyEvolution(id: string, cwd = process.cwd()): Promise<EvolutionCandidate> {
  const candidate = await readEvolutionCandidate(id, cwd);
  if (candidate.status !== 'approved') throw new Error(`Candidate '${id}' must be approved before apply.`);
  const target = resolveTarget(cwd, candidate.target);
  const current = await readOptional(target);
  if (hash(current) !== candidate.baseSha256) throw new Error('Target changed since proposal; refusing to apply stale candidate. Re-propose against the new baseline.');
  await mkdir(resolve(cwd, BACKUP_DIR), { recursive: true });
  await writeFile(backupPath(cwd, id), current);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, candidate.proposedContent);
  candidate.status = 'applied'; candidate.appliedAt = new Date().toISOString();
  await writeCandidate(cwd, candidate); return candidate;
}

export async function rollbackEvolution(id: string, cwd = process.cwd()): Promise<EvolutionCandidate> {
  const candidate = await readEvolutionCandidate(id, cwd);
  if (candidate.status !== 'applied') throw new Error(`Candidate '${id}' is not currently applied.`);
  const target = resolveTarget(cwd, candidate.target);
  const backup = await readFile(backupPath(cwd, id), 'utf8');
  await writeFile(target, backup);
  candidate.status = 'rolled_back'; candidate.rolledBackAt = new Date().toISOString();
  await writeCandidate(cwd, candidate); return candidate;
}
