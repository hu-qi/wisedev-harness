import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { mkdir, readFile, readdir, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Manifest, PolicyPackName } from './manifest.js';
import { MANIFEST_PATH } from './manifest.js';
import { LOCK_PATH } from './distribution.js';
import { redactText } from './knowledge.js';

const gzipAsync = promisify(gzip);

const POLICY_PACKS: Record<PolicyPackName, { deny: string[]; denyShellMetacharacters?: boolean; description: string }> = {
  'enterprise-baseline': {
    description: 'Blocks common publish, destructive-delete and force-push commands.',
    deny: ['npm publish', 'git push --force', 'git push -f', 'rm -rf']
  },
  'enterprise-strict': {
    description: 'Adds outbound shell/network launchers and shell metacharacter denial for tightly controlled environments.',
    deny: ['npm publish', 'git push --force', 'git push -f', 'rm -rf', 'curl', 'wget', 'ssh', 'scp'],
    denyShellMetacharacters: true
  }
};

export interface PolicyTrace {
  command: string;
  policyPacks: PolicyPackName[];
  shellMetacharacters: { enabled: boolean; matched: boolean; sources: string[] };
  denyMatches: string[];
  denySources: Record<string, string[]>;
  allowMatches: string[];
  allowListEnabled: boolean;
  conflicts: string[];
  allowed: boolean;
  reason: string;
}

function matches(pattern: string, value: string): boolean {
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
    try { return new RegExp(pattern.slice(1, -1)).test(value); } catch { return false; }
  }
  return value === pattern || value.startsWith(`${pattern} `);
}

function effectiveExecutionPolicy(manifest: Manifest) {
  const base = manifest.policies.execution;
  const denySources = new Map<string, string[]>();
  for (const pattern of base.deny) denySources.set(pattern, ['manifest']);
  const shellSources = base.denyShellMetacharacters ? ['manifest'] : [];
  for (const packName of manifest.policies.policyPacks) {
    const pack = POLICY_PACKS[packName];
    for (const pattern of pack.deny) denySources.set(pattern, [...new Set([...(denySources.get(pattern) ?? []), `pack:${packName}`])]);
    if (pack.denyShellMetacharacters) shellSources.push(`pack:${packName}`);
  }
  return {
    allow: base.allow,
    deny: [...denySources.keys()],
    denySources: Object.fromEntries(denySources),
    denyShellMetacharacters: shellSources.length > 0,
    shellSources: [...new Set(shellSources)]
  };
}

export function policyPackLines(): string[] {
  return (Object.entries(POLICY_PACKS) as Array<[PolicyPackName, (typeof POLICY_PACKS)[PolicyPackName]]>)
    .map(([name, pack]) => `${name}\t${pack.description}\tdeny=${pack.deny.join(',')}\tdenyShellMetacharacters=${Boolean(pack.denyShellMetacharacters)}`);
}

export function explainCommandPolicy(command: string, manifest: Manifest): PolicyTrace {
  const policy = effectiveExecutionPolicy(manifest);
  const shellMatched = /[;&|`$<>\n\r]/.test(command);
  const denyMatches = policy.deny.filter(pattern => matches(pattern, command));
  const allowMatches = policy.allow.filter(pattern => matches(pattern, command));
  const conflicts = denyMatches.length > 0 && allowMatches.length > 0
    ? [`deny wins over allow: deny=[${denyMatches.join(', ')}] allow=[${allowMatches.join(', ')}]`]
    : [];
  let allowed = true;
  let reason = 'allowed by execution policy';
  if (policy.denyShellMetacharacters && shellMatched) {
    allowed = false; reason = `shell metacharacters are denied by ${policy.shellSources.join(', ')}`;
  } else if (denyMatches.length > 0) {
    const first = denyMatches[0];
    allowed = false; reason = `command matches deny rule '${first}' from ${policy.denySources[first].join(', ')}`;
  } else if (policy.allow.length > 0 && allowMatches.length === 0) {
    allowed = false; reason = 'command does not match any allow rule';
  }
  return {
    command: redactText(command),
    policyPacks: manifest.policies.policyPacks,
    shellMetacharacters: { enabled: policy.denyShellMetacharacters, matched: shellMatched, sources: policy.shellSources },
    denyMatches,
    denySources: Object.fromEntries(denyMatches.map(pattern => [pattern, policy.denySources[pattern]])),
    allowMatches,
    allowListEnabled: policy.allow.length > 0,
    conflicts,
    allowed,
    reason
  };
}

async function readOptional(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf8'); }
  catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function readJsonFiles(dir: string): Promise<any[]> {
  try {
    const names = (await readdir(dir)).filter(name => name.endsWith('.json')).sort();
    return Promise.all(names.map(async name => JSON.parse(await readFile(join(dir, name), 'utf8'))));
  } catch (error: any) { if (error?.code === 'ENOENT') return []; throw error; }
}

async function readJsonLines(path: string): Promise<any[]> {
  const text = await readOptional(path);
  if (!text) return [];
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

export interface HealthSummary {
  sessions: number;
  frictionTotal: number;
  frictionAverage: number;
  highFrictionSessions: number;
  deniedSecurityEvents: number;
  learningCount: number;
  pendingLearningCandidates: number;
  status: 'healthy' | 'watch' | 'degraded';
  reasons: string[];
}

export async function buildHealthSummary(cwd = process.cwd(), frictionThreshold = 5): Promise<HealthSummary> {
  const summaries = await readJsonFiles(resolve(cwd, '.agents/session-summaries'));
  const security = await readJsonLines(resolve(cwd, '.agents/audit/security.jsonl'));
  const learnings = await readJsonFiles(resolve(cwd, '.agents/learnings'));
  const candidates = await readJsonFiles(resolve(cwd, '.agents/learning-candidates'));
  const frictionTotal = summaries.reduce((sum, item) => sum + Number(item.frictionScore ?? 0), 0);
  const highFrictionSessions = summaries.filter(item => Number(item.frictionScore ?? 0) >= frictionThreshold).length;
  const deniedSecurityEvents = security.filter(item => item.allowed === false).length;
  const reasons: string[] = [];
  if (summaries.length >= 3 && highFrictionSessions / summaries.length >= 0.5) reasons.push('at least half of recorded sessions are high-friction');
  if (deniedSecurityEvents >= 5) reasons.push('five or more security-denied events are recorded');
  if (candidates.length >= 5) reasons.push('five or more learning candidates are awaiting review');
  const status: HealthSummary['status'] = reasons.length >= 2 ? 'degraded' : reasons.length === 1 ? 'watch' : 'healthy';
  return {
    sessions: summaries.length,
    frictionTotal,
    frictionAverage: summaries.length ? Number((frictionTotal / summaries.length).toFixed(2)) : 0,
    highFrictionSessions,
    deniedSecurityEvents,
    learningCount: learnings.length,
    pendingLearningCandidates: candidates.length,
    status,
    reasons
  };
}

interface AuditBundle {
  version: 1;
  createdAt: string;
  project: string;
  manifestSha256: string;
  manifest: unknown;
  lock: unknown | null;
  sessionSummaries: unknown[];
  securityEvents: unknown[];
  learnings: unknown[];
  health: HealthSummary;
}

export async function exportAuditBundle(output: string, manifest: Manifest, cwd = process.cwd()): Promise<string> {
  const manifestText = await readFile(resolve(cwd, MANIFEST_PATH), 'utf8');
  const lockText = await readOptional(resolve(cwd, LOCK_PATH));
  const sessionSummaries = await readJsonFiles(resolve(cwd, '.agents/session-summaries'));
  const securityEvents = await readJsonLines(resolve(cwd, '.agents/audit/security.jsonl'));
  const learnings = await readJsonFiles(resolve(cwd, '.agents/learnings'));
  const bundle: AuditBundle = {
    version: 1,
    createdAt: new Date().toISOString(),
    project: manifest.project.name,
    manifestSha256: createHash('sha256').update(manifestText).digest('hex'),
    manifest: JSON.parse(JSON.stringify(manifest)),
    lock: lockText ? JSON.parse(lockText) : null,
    sessionSummaries,
    securityEvents,
    learnings,
    health: await buildHealthSummary(cwd)
  };
  const target = resolve(cwd, output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, await gzipAsync(Buffer.from(JSON.stringify(bundle, null, 2))));
  return target;
}

export interface TelemetryConfig { enabled: boolean; includeProjectName: boolean }
const TELEMETRY_CONFIG = '.agents/telemetry.json';
const TELEMETRY_EVENTS = '.agents/telemetry/events.jsonl';

export async function readTelemetryConfig(cwd = process.cwd()): Promise<TelemetryConfig> {
  try {
    const raw = JSON.parse(await readFile(resolve(cwd, TELEMETRY_CONFIG), 'utf8'));
    return { enabled: raw.enabled === true, includeProjectName: raw.includeProjectName === true };
  } catch (error: any) { if (error?.code === 'ENOENT') return { enabled: false, includeProjectName: false }; throw error; }
}

export async function setTelemetry(enabled: boolean, includeProjectName = false, cwd = process.cwd()): Promise<TelemetryConfig> {
  const config = { enabled, includeProjectName };
  await mkdir(resolve(cwd, '.agents'), { recursive: true });
  await writeFile(resolve(cwd, TELEMETRY_CONFIG), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  return config;
}

export async function emitTelemetry(type: string, data: Record<string, unknown>, manifest: Manifest, cwd = process.cwd()): Promise<boolean> {
  const config = await readTelemetryConfig(cwd);
  if (!config.enabled) return false;
  const path = resolve(cwd, TELEMETRY_EVENTS);
  await mkdir(dirname(path), { recursive: true });
  const event = {
    at: new Date().toISOString(),
    type,
    ...(config.includeProjectName ? { project: manifest.project.name } : {}),
    data: JSON.parse(redactText(JSON.stringify(data)))
  };
  await appendFile(path, JSON.stringify(event) + '\n', { mode: 0o600 });
  return true;
}
