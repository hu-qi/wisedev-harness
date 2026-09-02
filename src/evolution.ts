import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { redactText } from './knowledge.js';
import { loadManifest } from './manifest.js';
import { auditSecurityEvent, evaluateCommandPolicy, resolveSecureProjectPath, scanSecrets } from './security.js';
import { isManifestTrusted } from './trust.js';

const CANDIDATE_DIR = '.agents/evolution-candidates';
const BACKUP_DIR = '.agents/evolution-backups';

export interface EvolutionEval { at: string; command: string; passed: boolean; exitCode: number; stdout: string; stderr: string }
export interface EvolutionCandidate {
  version: 1;
  id: string;
  target: string;
  reason: string;
  sourceLearning?: string;
  baseSha256: string;
  baseExisted: boolean;
  proposedContent: string;
  createdAt: string;
  status: 'proposed' | 'approved' | 'applied' | 'rolled_back';
  evaluations: EvolutionEval[];
  approvedAt?: string;
  appliedAt?: string;
  rolledBackAt?: string;
}

function hash(content: string): string { return createHash('sha256').update(content).digest('hex'); }
async function exists(path: string): Promise<boolean> { try { await stat(path); return true; } catch { return false; } }
async function readOptional(path: string): Promise<string> { try { return await readFile(path, 'utf8'); } catch (error: any) { if (error?.code === 'ENOENT') return ''; throw error; } }
function candidatePath(cwd: string, id: string): string { return resolve(cwd, CANDIDATE_DIR, `${id}.json`); }
function backupPath(cwd: string, id: string): string { return resolve(cwd, BACKUP_DIR, `${id}.txt`); }
async function writeCandidate(cwd: string, candidate: EvolutionCandidate): Promise<void> { await mkdir(resolve(cwd, CANDIDATE_DIR), { recursive: true }); await writeFile(candidatePath(cwd, candidate.id), JSON.stringify(candidate, null, 2) + '\n'); }
async function secureTarget(cwd: string, target: string): Promise<string> {
  if (target === '.git' || target.startsWith('.git/') || target.startsWith('.agents/evolution-')) throw new Error(`Protected evolution target '${target}'.`);
  const manifest = await loadManifest(cwd);
  return resolveSecureProjectPath(cwd, target, manifest.policies.protectSymlinkEscapes);
}

export async function readEvolutionCandidate(id: string, cwd = process.cwd()): Promise<EvolutionCandidate> { return JSON.parse(await readFile(candidatePath(cwd, id), 'utf8')) as EvolutionCandidate; }

export async function proposeEvolution(target: string, proposedContent: string, reason: string, sourceLearning?: string, cwd = process.cwd()): Promise<EvolutionCandidate> {
  const absolute = await secureTarget(cwd, target); const baseExisted = await exists(absolute); const base = await readOptional(absolute);
  const candidate: EvolutionCandidate = { version: 1, id: randomUUID(), target, reason: redactText(reason), ...(sourceLearning ? { sourceLearning } : {}), baseSha256: hash(base), baseExisted, proposedContent, createdAt: new Date().toISOString(), status: 'proposed', evaluations: [] };
  await writeCandidate(cwd, candidate); return candidate;
}

export function evolutionDiff(candidate: EvolutionCandidate, currentContent: string) {
  const before = currentContent.split('\n'); const after = candidate.proposedContent.split('\n'); const max = Math.max(before.length, after.length); let changed = 0;
  for (let i = 0; i < max; i += 1) if (before[i] !== after[i]) changed += 1;
  return { baselineLines: before.length, candidateLines: after.length, changedLineCount: changed, baseMatchesCurrent: hash(currentContent) === candidate.baseSha256 };
}

export async function evaluateEvolution(id: string, command: string, cwd = process.cwd()): Promise<EvolutionEval> {
  if (!(await isManifestTrusted(cwd))) throw new Error('Evolution eval commands require a trusted current manifest.');
  const manifest = await loadManifest(cwd);
  const decision = evaluateCommandPolicy(command, manifest);
  await auditSecurityEvent(cwd, { action: 'evolution-evaluate', candidateId: id, allowed: decision.allowed, reason: decision.reason });
  if (!decision.allowed) throw new Error(`Evolution evaluator blocked: ${decision.reason}.`);
  const candidate = await readEvolutionCandidate(id, cwd);
  if (candidate.status !== 'proposed') throw new Error(`Candidate '${id}' is ${candidate.status}; only proposed candidates can be evaluated.`);
  const target = await secureTarget(cwd, candidate.target);
  const scratchDir = resolve(cwd, '.agents/evolution-eval', id); await mkdir(scratchDir, { recursive: true }); const candidateFile = resolve(scratchDir, 'candidate.txt'); await writeFile(candidateFile, candidate.proposedContent);
  const result = spawnSync('sh', ['-lc', command], { cwd, encoding: 'utf8', timeout: 300_000, env: { ...process.env, WISEDEV_EVOLUTION_ID: id, WISEDEV_CANDIDATE_FILE: candidateFile, WISEDEV_TARGET_FILE: target } });
  const record: EvolutionEval = { at: new Date().toISOString(), command: redactText(command), passed: !result.error && result.status === 0, exitCode: result.status ?? 1, stdout: redactText(String(result.stdout ?? '')).slice(-8000), stderr: redactText(String(result.stderr ?? result.error?.message ?? '')).slice(-8000) };
  candidate.evaluations.push(record); await writeCandidate(cwd, candidate); return record;
}

export async function approveEvolution(id: string, cwd = process.cwd()): Promise<EvolutionCandidate> {
  const manifest = await loadManifest(cwd);
  const candidate = await readEvolutionCandidate(id, cwd);
  if (candidate.status !== 'proposed') throw new Error(`Candidate '${id}' is ${candidate.status}.`);
  if (!candidate.evaluations.some(item => item.passed)) throw new Error('At least one passing evaluation is required before approval.');
  if (manifest.policies.secretScan) {
    const findings = scanSecrets(candidate.proposedContent);
    if (findings.length > 0) {
      await auditSecurityEvent(cwd, { action: 'evolution-approve', candidateId: id, allowed: false, reason: 'secret-scan', findingKinds: [...new Set(findings.map(item => item.kind))] });
      throw new Error(`Candidate contains potential secrets: ${[...new Set(findings.map(item => item.kind))].join(', ')}.`);
    }
  }
  candidate.status = 'approved'; candidate.approvedAt = new Date().toISOString(); await writeCandidate(cwd, candidate);
  await auditSecurityEvent(cwd, { action: 'evolution-approve', candidateId: id, allowed: true });
  return candidate;
}

export async function applyEvolution(id: string, cwd = process.cwd()): Promise<EvolutionCandidate> {
  const candidate = await readEvolutionCandidate(id, cwd);
  if (candidate.status !== 'approved') throw new Error(`Candidate '${id}' must be approved before apply.`);
  const target = await secureTarget(cwd, candidate.target); const current = await readOptional(target);
  if (hash(current) !== candidate.baseSha256 || (await exists(target)) !== candidate.baseExisted) throw new Error('Target changed since proposal; refusing to apply stale candidate. Re-propose against the new baseline.');
  await mkdir(resolve(cwd, BACKUP_DIR), { recursive: true }); if (candidate.baseExisted) await writeFile(backupPath(cwd, id), current);
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, candidate.proposedContent);
  candidate.status = 'applied'; candidate.appliedAt = new Date().toISOString(); await writeCandidate(cwd, candidate);
  await auditSecurityEvent(cwd, { action: 'evolution-apply', candidateId: id, allowed: true, target: candidate.target });
  return candidate;
}

export async function rollbackEvolution(id: string, cwd = process.cwd()): Promise<EvolutionCandidate> {
  const candidate = await readEvolutionCandidate(id, cwd);
  if (candidate.status !== 'applied') throw new Error(`Candidate '${id}' is not currently applied.`);
  const target = await secureTarget(cwd, candidate.target);
  if (candidate.baseExisted) await writeFile(target, await readFile(backupPath(cwd, id), 'utf8')); else await rm(target, { force: true });
  candidate.status = 'rolled_back'; candidate.rolledBackAt = new Date().toISOString(); await writeCandidate(cwd, candidate);
  await auditSecurityEvent(cwd, { action: 'evolution-rollback', candidateId: id, allowed: true, target: candidate.target });
  return candidate;
}
