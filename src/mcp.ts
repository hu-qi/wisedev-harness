import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Manifest, McpServer, RuntimeName } from './manifest.js';
import { isManifestTrusted } from './trust.js';

const STATE_PATH = '.agents/mcp-state.json';
const CODEX_START = '# wisedev-harness:mcp:start';
const CODEX_END = '# wisedev-harness:mcp:end';

interface McpState { version: 1; managed: Partial<Record<RuntimeName, string[]>> }

async function readState(cwd: string): Promise<McpState> {
  try { return JSON.parse(await readFile(resolve(cwd, STATE_PATH), 'utf8')) as McpState; }
  catch (error: any) { if (error?.code === 'ENOENT') return { version: 1, managed: {} }; throw error; }
}
async function writeState(cwd: string, state: McpState): Promise<void> {
  await mkdir(resolve(cwd, '.agents'), { recursive: true });
  await writeFile(resolve(cwd, STATE_PATH), JSON.stringify(state, null, 2) + '\n');
}
async function readJson(path: string): Promise<any> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error: any) { if (error?.code === 'ENOENT') return {}; throw error; }
}
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}
function selected(manifest: Manifest, runtime: RuntimeName): McpServer[] {
  return manifest.mcpServers.filter(server => server.enabled && (!server.runtimes || server.runtimes.includes(runtime)));
}
function jsonServer(server: McpServer): Record<string, unknown> {
  if (server.transport === 'stdio') return { command: server.command, args: server.args, ...(Object.keys(server.env).length ? { env: server.env } : {}) };
  return { type: 'http', url: server.url, ...(Object.keys(server.headers).length ? { headers: server.headers } : {}) };
}

async function reconcileJsonRuntime(manifest: Manifest, runtime: 'claude' | 'cursor', cwd: string, state: McpState, remove = false): Promise<string> {
  const path = runtime === 'claude' ? resolve(cwd, '.mcp.json') : resolve(cwd, '.cursor/mcp.json');
  const json = await readJson(path);
  if (json.mcpServers !== undefined && (typeof json.mcpServers !== 'object' || Array.isArray(json.mcpServers))) throw new Error(`${path} has invalid mcpServers; expected an object.`);
  json.mcpServers ??= {};
  const previouslyManaged = new Set(state.managed[runtime] ?? []);
  for (const name of previouslyManaged) delete json.mcpServers[name];
  const servers = remove ? [] : selected(manifest, runtime);
  for (const server of servers) {
    if (Object.prototype.hasOwnProperty.call(json.mcpServers, server.name) && !previouslyManaged.has(server.name)) {
      throw new Error(`Refusing to overwrite unmanaged MCP server '${server.name}' in ${path}.`);
    }
    json.mcpServers[server.name] = jsonServer(server);
  }
  state.managed[runtime] = servers.map(server => server.name);
  await writeJson(path, json);
  return path;
}

function tomlString(value: string): string { return JSON.stringify(value); }
function tomlArray(values: string[]): string { return `[${values.map(tomlString).join(', ')}]`; }
function tomlInlineTable(value: Record<string, string>): string {
  return `{ ${Object.entries(value).map(([key, item]) => `${tomlString(key)} = ${tomlString(item)}`).join(', ')} }`;
}
function renderCodexServer(server: McpServer): string {
  const lines = [`[mcp_servers.${tomlString(server.name)}]`];
  if (server.transport === 'stdio') {
    lines.push(`command = ${tomlString(server.command)}`);
    if (server.args.length) lines.push(`args = ${tomlArray(server.args)}`);
    if (Object.keys(server.env).length) lines.push(`env = ${tomlInlineTable(server.env)}`);
  } else {
    lines.push(`url = ${tomlString(server.url)}`);
    if (server.bearerTokenEnvVar) lines.push(`bearer_token_env_var = ${tomlString(server.bearerTokenEnvVar)}`);
    if (Object.keys(server.headers).length) lines.push(`http_headers = ${tomlInlineTable(server.headers)}`);
  }
  return lines.join('\n');
}
function stripManagedToml(text: string): { outside: string; hadBlock: boolean } {
  const start = text.indexOf(CODEX_START);
  const end = text.indexOf(CODEX_END);
  if (start === -1 && end === -1) return { outside: text, hadBlock: false };
  if (start === -1 || end === -1 || end < start) throw new Error('Malformed WiseDev MCP managed block in .codex/config.toml; refusing to modify it automatically.');
  const after = end + CODEX_END.length;
  return { outside: `${text.slice(0, start)}${text.slice(after)}`.trimEnd(), hadBlock: true };
}
async function reconcileCodex(manifest: Manifest, cwd: string, state: McpState, remove = false): Promise<string> {
  const path = resolve(cwd, '.codex/config.toml');
  let existing = '';
  try { existing = await readFile(path, 'utf8'); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  const { outside } = stripManagedToml(existing);
  const previouslyManaged = new Set(state.managed.codex ?? []);
  const servers = remove ? [] : selected(manifest, 'codex');
  for (const server of servers) {
    const pattern = new RegExp(`\\[mcp_servers\\.(?:"${server.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"|${server.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\]`);
    if (pattern.test(outside) && !previouslyManaged.has(server.name)) throw new Error(`Refusing to overwrite unmanaged Codex MCP server '${server.name}' in ${path}.`);
  }
  const block = servers.length ? `${CODEX_START}\n${servers.map(renderCodexServer).join('\n\n')}\n${CODEX_END}` : '';
  const next = [outside.trimEnd(), block].filter(Boolean).join('\n\n') + (outside || block ? '\n' : '');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next);
  state.managed.codex = servers.map(server => server.name);
  return path;
}

export async function reconcileMcp(manifest: Manifest, cwd = process.cwd(), remove = false): Promise<string[]> {
  if (!remove && !(await isManifestTrusted(cwd))) {
    throw new Error('MCP injection requires the exact current manifest to be trusted. Review .agents/manifest.yaml and run `wisedev-harness trust` first.');
  }
  const state = await readState(cwd);
  const files: string[] = [];
  for (const runtime of manifest.runtimes) {
    if (runtime === 'claude') files.push(await reconcileJsonRuntime(manifest, 'claude', cwd, state, remove));
    if (runtime === 'cursor') files.push(await reconcileJsonRuntime(manifest, 'cursor', cwd, state, remove));
    if (runtime === 'codex') files.push(await reconcileCodex(manifest, cwd, state, remove));
  }
  await writeState(cwd, state);
  return files;
}

export function listMcp(manifest: Manifest): string[] {
  return manifest.mcpServers.map(server => `${server.enabled ? 'ENABLED' : 'DISABLED'}\t${server.name}\t${server.transport}\truntimes=${server.runtimes?.join(',') ?? manifest.runtimes.join(',')}`);
}
