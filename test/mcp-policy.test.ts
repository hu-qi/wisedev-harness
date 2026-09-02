import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { explainCommandPolicy } from '../src/enterprise.js';
import { ManifestSchema, serializeManifest } from '../src/manifest.js';
import { reconcileMcp } from '../src/mcp.js';
import { evaluateCommandPolicy } from '../src/security.js';
import { trustManifest } from '../src/trust.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function temp(prefix: string) { const root = await mkdtemp(join(tmpdir(), prefix)); roots.push(root); return root; }
async function writeManifest(root: string, value: any) {
  const manifest = ManifestSchema.parse(value);
  await mkdir(join(root, '.agents'), { recursive: true });
  await writeFile(join(root, '.agents/manifest.yaml'), serializeManifest(manifest));
  return manifest;
}

describe('enterprise policy packs', () => {
  it('only tightens execution and explains deny-over-allow conflicts', () => {
    const manifest = ManifestSchema.parse({
      version: 1,
      project: { name: 'fixture' },
      runtimes: ['codex'],
      policies: {
        execution: { allow: ['npm'], deny: [], denyShellMetacharacters: false },
        policyPacks: ['enterprise-baseline']
      }
    });
    expect(evaluateCommandPolicy('npm test', manifest).allowed).toBe(true);
    const trace = explainCommandPolicy('npm publish', manifest);
    expect(trace.allowed).toBe(false);
    expect(trace.allowMatches).toContain('npm');
    expect(trace.denyMatches).toContain('npm publish');
    expect(trace.denySources['npm publish']).toContain('pack:enterprise-baseline');
    expect(trace.conflicts[0]).toMatch(/deny wins over allow/);
  });

  it('strict pack enables shell metacharacter denial without changing manifest allow entries', () => {
    const manifest = ManifestSchema.parse({
      version: 1,
      project: { name: 'fixture' },
      runtimes: ['codex'],
      policies: { execution: { allow: ['npm'], deny: [], denyShellMetacharacters: false }, policyPacks: ['enterprise-strict'] }
    });
    const trace = explainCommandPolicy('npm test && echo hi', manifest);
    expect(trace.allowed).toBe(false);
    expect(trace.shellMetacharacters.enabled).toBe(true);
    expect(trace.shellMetacharacters.sources).toContain('pack:enterprise-strict');
  });
});

describe('trusted MCP reconciliation', () => {
  it('requires trust, preserves unmanaged JSON servers, and removes only managed servers', async () => {
    const root = await temp('wisedev-mcp-json-');
    const manifest = await writeManifest(root, {
      version: 1,
      project: { name: 'fixture' },
      runtimes: ['claude', 'cursor'],
      mcpServers: [{ name: 'wise', transport: 'stdio', command: 'npx', args: ['-y', 'wise-mcp'], env: { MODE: 'test' } }]
    });
    await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { userOwned: { command: 'echo', args: ['user'] } } }, null, 2));
    await writeFile(join(root, '.cursor/mcp.json'), JSON.stringify({ mcpServers: { cursorOwned: { command: 'echo' } } }, null, 2)).catch(async () => {
      await mkdir(join(root, '.cursor'), { recursive: true });
      await writeFile(join(root, '.cursor/mcp.json'), JSON.stringify({ mcpServers: { cursorOwned: { command: 'echo' } } }, null, 2));
    });

    await expect(reconcileMcp(manifest, root)).rejects.toThrow(/trust/i);
    await trustManifest(root);
    await reconcileMcp(manifest, root);
    const claude = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'));
    const cursor = JSON.parse(await readFile(join(root, '.cursor/mcp.json'), 'utf8'));
    expect(claude.mcpServers.userOwned).toBeTruthy();
    expect(claude.mcpServers.wise.command).toBe('npx');
    expect(cursor.mcpServers.cursorOwned).toBeTruthy();
    expect(cursor.mcpServers.wise).toBeTruthy();

    await reconcileMcp(manifest, root, true);
    const cleaned = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'));
    expect(cleaned.mcpServers.userOwned).toBeTruthy();
    expect(cleaned.mcpServers.wise).toBeUndefined();
  });

  it('renders Codex stdio/http MCP tables inside one managed block and preserves user TOML', async () => {
    const root = await temp('wisedev-mcp-codex-');
    const manifest = await writeManifest(root, {
      version: 1,
      project: { name: 'fixture' },
      runtimes: ['codex'],
      mcpServers: [
        { name: 'stdio-tool', transport: 'stdio', command: 'npx', args: ['-y', 'server'], env: { MODE: 'prod' } },
        { name: 'remote-tool', transport: 'http', url: 'https://mcp.example.com/mcp', bearerTokenEnvVar: 'MCP_TOKEN', headers: { 'X-Team': 'wise' } }
      ]
    });
    await mkdir(join(root, '.codex'), { recursive: true });
    await writeFile(join(root, '.codex/config.toml'), 'model = "gpt-test"\n');
    await trustManifest(root);
    await reconcileMcp(manifest, root);
    const text = await readFile(join(root, '.codex/config.toml'), 'utf8');
    expect(text).toContain('model = "gpt-test"');
    expect(text).toContain('# wisedev-harness:mcp:start');
    expect(text).toContain('[mcp_servers."stdio-tool"]');
    expect(text).toContain('command = "npx"');
    expect(text).toContain('[mcp_servers."remote-tool"]');
    expect(text).toContain('url = "https://mcp.example.com/mcp"');
    expect(text).toContain('bearer_token_env_var = "MCP_TOKEN"');
  });

  it('refuses to overwrite an unmanaged same-name MCP server', async () => {
    const root = await temp('wisedev-mcp-conflict-');
    const manifest = await writeManifest(root, {
      version: 1,
      project: { name: 'fixture' },
      runtimes: ['claude'],
      mcpServers: [{ name: 'existing', transport: 'stdio', command: 'new-command' }]
    });
    await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { existing: { command: 'user-command' } } }, null, 2));
    await trustManifest(root);
    await expect(reconcileMcp(manifest, root)).rejects.toThrow(/unmanaged MCP server 'existing'/);
    const current = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'));
    expect(current.mcpServers.existing.command).toBe('user-command');
  });
});
