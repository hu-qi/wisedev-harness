import { gunzipSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { buildHealthSummary, emitTelemetry, explainCommandPolicy, exportAuditBundle, readTelemetryConfig, setTelemetry } from '../src/enterprise.js';
import { ManifestSchema, serializeManifest } from '../src/manifest.js';
import { evaluateCommandPolicy } from '../src/security.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function temp(prefix: string) { const root = await mkdtemp(join(tmpdir(), prefix)); roots.push(root); return root; }
async function manifestAt(root: string) {
  const manifest = ManifestSchema.parse({
    version: 1,
    project: { name: 'fixture' },
    runtimes: ['codex'],
    policies: { execution: { allow: ['npm', 'git status'], deny: ['npm publish', 'rm'], denyShellMetacharacters: true } }
  });
  await mkdir(join(root, '.agents'), { recursive: true });
  await writeFile(join(root, '.agents/manifest.yaml'), serializeManifest(manifest));
  return manifest;
}

describe('enterprise operations', () => {
  it('uses one deterministic policy decision for explain and execution', async () => {
    const root = await temp('wisedev-enterprise-policy-');
    const manifest = await manifestAt(root);
    for (const command of ['npm test', 'npm publish', 'curl example.com', 'npm test && echo bad']) {
      const trace = explainCommandPolicy(command, manifest);
      const decision = evaluateCommandPolicy(command, manifest);
      expect({ allowed: trace.allowed, reason: trace.reason }).toEqual(decision);
    }
    expect(explainCommandPolicy('npm test', manifest).allowMatches).toContain('npm');
    expect(explainCommandPolicy('npm publish', manifest).denyMatches).toContain('npm publish');
    expect(explainCommandPolicy('npm test && echo bad', manifest).shellMetacharacters.matched).toBe(true);
  });

  it('builds explainable health from summaries, denied security events and pending learnings', async () => {
    const root = await temp('wisedev-enterprise-health-');
    await mkdir(join(root, '.agents/session-summaries'), { recursive: true });
    for (const [i, frictionScore] of [7, 8, 0].entries()) {
      await writeFile(join(root, `.agents/session-summaries/${i}.json`), JSON.stringify({ frictionScore }));
    }
    await mkdir(join(root, '.agents/audit'), { recursive: true });
    await writeFile(join(root, '.agents/audit/security.jsonl'), Array.from({ length: 5 }, (_, i) => JSON.stringify({ allowed: false, id: i })).join('\n') + '\n');
    await mkdir(join(root, '.agents/learning-candidates'), { recursive: true });
    for (let i = 0; i < 5; i += 1) await writeFile(join(root, `.agents/learning-candidates/${i}.json`), '{}');
    const health = await buildHealthSummary(root);
    expect(health.status).toBe('degraded');
    expect(health.highFrictionSessions).toBe(2);
    expect(health.deniedSecurityEvents).toBe(5);
    expect(health.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('exports a bounded structured audit bundle without raw session or trust state', async () => {
    const root = await temp('wisedev-enterprise-audit-');
    const manifest = await manifestAt(root);
    await mkdir(join(root, '.agents/session-summaries'), { recursive: true });
    await writeFile(join(root, '.agents/session-summaries/s1.json'), JSON.stringify({ frictionScore: 2, task: 'safe summary' }));
    await mkdir(join(root, '.agents/sessions'), { recursive: true });
    await writeFile(join(root, '.agents/sessions/raw.jsonl'), JSON.stringify({ message: 'RAW-MUST-NOT-EXPORT' }));
    await writeFile(join(root, '.agents/trust.json'), JSON.stringify({ secret: 'TRUST-MUST-NOT-EXPORT' }));
    const output = await exportAuditBundle('audit.wdh-audit.gz', manifest, root);
    const bundle = JSON.parse(gunzipSync(await readFile(output)).toString('utf8'));
    const encoded = JSON.stringify(bundle);
    expect(bundle.version).toBe(1);
    expect(bundle.sessionSummaries).toHaveLength(1);
    expect(encoded).not.toContain('RAW-MUST-NOT-EXPORT');
    expect(encoded).not.toContain('TRUST-MUST-NOT-EXPORT');
    expect(bundle.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('redacts MCP env and header values from audit bundles', async () => {
    const root = await temp('wisedev-enterprise-audit-mcp-');
    const manifest = ManifestSchema.parse({
      version: 1,
      project: { name: 'fixture' },
      runtimes: ['claude'],
      mcpServers: [
        { name: 'local', transport: 'stdio', command: 'server', env: { API_TOKEN: 'super-secret-env-value' } },
        { name: 'remote', transport: 'http', url: 'https://mcp.example.com', headers: { Authorization: 'Bearer super-secret-header-value' } }
      ]
    });
    await mkdir(join(root, '.agents'), { recursive: true });
    await writeFile(join(root, '.agents/manifest.yaml'), serializeManifest(manifest));
    const output = await exportAuditBundle('audit.wdh-audit.gz', manifest, root);
    const bundle = JSON.parse(gunzipSync(await readFile(output)).toString('utf8'));
    const encoded = JSON.stringify(bundle);
    expect(encoded).not.toContain('super-secret-env-value');
    expect(encoded).not.toContain('super-secret-header-value');
    expect(bundle.manifest.mcpServers[0].env.API_TOKEN).toBe('[REDACTED]');
    expect(bundle.manifest.mcpServers[1].headers.Authorization).toBe('[REDACTED]');
  });

  it('keeps telemetry disabled by default and redacts enabled local events', async () => {
    const root = await temp('wisedev-enterprise-telemetry-');
    const manifest = await manifestAt(root);
    expect(await readTelemetryConfig(root)).toEqual({ enabled: false, includeProjectName: false });
    expect(await emitTelemetry('test', { token: 'sk-abcdefghijklmnopqrstuvwxyz123456' }, manifest, root)).toBe(false);
    await expect(readFile(join(root, '.agents/telemetry/events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await setTelemetry(true, false, root);
    expect(await emitTelemetry('test', { token: 'sk-abcdefghijklmnopqrstuvwxyz123456' }, manifest, root)).toBe(true);
    const event = await readFile(join(root, '.agents/telemetry/events.jsonl'), 'utf8');
    expect(event).toContain('[REDACTED]');
    expect(event).not.toContain('fixture');
    expect(event).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
  });
});
