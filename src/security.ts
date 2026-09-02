import { appendFile, lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Manifest } from './manifest.js';
import { redactText } from './knowledge.js';

export interface PolicyDecision { allowed: boolean; reason: string }
export interface SecretFinding { kind: string; match: string }

function matches(pattern: string, value: string): boolean {
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
    try { return new RegExp(pattern.slice(1, -1)).test(value); } catch { return false; }
  }
  return value === pattern || value.startsWith(`${pattern} `);
}

export function evaluateCommandPolicy(command: string, manifest: Manifest): PolicyDecision {
  const policy = manifest.policies.execution;
  if (policy.denyShellMetacharacters && /[;&|`$<>\n\r]/.test(command)) return { allowed: false, reason: 'shell metacharacters are denied by policy' };
  const denied = policy.deny.find(pattern => matches(pattern, command));
  if (denied) return { allowed: false, reason: `command matches deny rule '${denied}'` };
  if (policy.allow.length > 0) {
    const allowed = policy.allow.find(pattern => matches(pattern, command));
    if (!allowed) return { allowed: false, reason: 'command does not match any allow rule' };
  }
  return { allowed: true, reason: 'allowed by execution policy' };
}

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['openai-key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g],
  ['aws-access-key', /\bAKIA[A-Z0-9]{16}\b/g],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}={0,2}\b/gi],
  ['credential-assignment', /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\b\s*[:=]\s*[^\s,;]{8,}/gi]
];

export function scanSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const [kind, pattern] of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) findings.push({ kind, match: redactText(match[0]) });
  }
  return findings;
}

async function existingAncestor(path: string): Promise<string> {
  let current = path;
  while (true) {
    try { await lstat(current); return current; } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw new Error(`Cannot resolve existing ancestor for ${path}`);
      current = parent;
    }
  }
}

export async function resolveSecureProjectPath(cwd: string, target: string, protectSymlinkEscapes = true): Promise<string> {
  if (!target || target.startsWith('/') || target === '..' || target.includes('../') || target.includes('\\..\\')) throw new Error(`Unsafe project path '${target}'.`);
  const lexicalRoot = resolve(cwd);
  const lexicalTarget = resolve(lexicalRoot, target);
  if (lexicalTarget !== lexicalRoot && !lexicalTarget.startsWith(`${lexicalRoot}${sep}`)) throw new Error(`Path escapes project root: ${target}`);
  if (!protectSymlinkEscapes) return lexicalTarget;

  const realRoot = await realpath(lexicalRoot);
  const ancestor = await existingAncestor(lexicalTarget);
  const realAncestor = await realpath(ancestor);
  if (realAncestor !== realRoot && !realAncestor.startsWith(`${realRoot}${sep}`)) throw new Error(`Path escapes project root through symlink: ${target}`);
  return lexicalTarget;
}

export async function auditSecurityEvent(cwd: string, event: Record<string, unknown>): Promise<void> {
  const path = resolve(cwd, '.agents/audit/security.jsonl');
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 });
}

export async function scanFileSecrets(path: string): Promise<SecretFinding[]> {
  const info = await stat(path);
  if (!info.isFile()) return [];
  return scanSecrets(await readFile(path, 'utf8'));
}
