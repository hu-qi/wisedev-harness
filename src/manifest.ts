import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { parse, stringify } from 'yaml';
import { MANIFEST_PATH } from './constants.js';
import { HarnessError } from './errors.js';
import { SUPPORTED_AGENTS, type AgentId, type Diagnostic, type HarnessManifest } from './types.js';
import { exists, readUtf8, resolveInside, sha256 } from './utils.js';

export interface LoadedManifest {
  manifest: HarnessManifest;
  raw: string;
  hash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw new HarnessError('INVALID_MANIFEST', `${field} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((entry) => (entry as string).trim()))];
}

export function validateManifest(value: unknown): HarnessManifest {
  if (!isRecord(value)) throw new HarnessError('INVALID_MANIFEST', 'Manifest root must be an object');
  if (value.version !== 1) throw new HarnessError('UNSUPPORTED_MANIFEST_VERSION', 'manifest.version must be 1');

  const project = value.project;
  if (!isRecord(project) || typeof project.name !== 'string' || project.name.trim() === '') {
    throw new HarnessError('INVALID_MANIFEST', 'project.name must be a non-empty string');
  }

  const agentsRaw = stringArray(value.agents, 'agents');
  if (agentsRaw.length === 0) throw new HarnessError('INVALID_MANIFEST', 'agents must contain at least one agent');
  const unsupported = agentsRaw.filter((agent) => !(SUPPORTED_AGENTS as readonly string[]).includes(agent));
  if (unsupported.length > 0) {
    throw new HarnessError('UNSUPPORTED_AGENT', `Unsupported agent(s): ${unsupported.join(', ')}`);
  }

  const resources = value.resources;
  if (!isRecord(resources)) throw new HarnessError('INVALID_MANIFEST', 'resources must be an object');
  const skills = stringArray(resources.skills, 'resources.skills');
  const rules = stringArray(resources.rules, 'resources.rules');

  const policies = value.policies;
  if (!isRecord(policies) || (policies.conflict !== 'fail' && policies.conflict !== 'overwrite')) {
    throw new HarnessError('INVALID_MANIFEST', 'policies.conflict must be "fail" or "overwrite"');
  }

  return {
    version: 1,
    project: { name: project.name.trim() },
    agents: agentsRaw as AgentId[],
    resources: { skills, rules },
    policies: { conflict: policies.conflict },
  };
}

export async function loadManifest(root: string): Promise<LoadedManifest> {
  const target = resolveInside(root, MANIFEST_PATH);
  if (!(await exists(target))) {
    throw new HarnessError('MANIFEST_NOT_FOUND', `Harness manifest not found at ${MANIFEST_PATH}`);
  }
  const raw = await readUtf8(target);
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (error) {
    throw new HarnessError('INVALID_YAML', `Unable to parse ${MANIFEST_PATH}`, { cause: error });
  }
  return { manifest: validateManifest(parsed), raw, hash: sha256(raw) };
}

export function createDefaultManifest(projectName: string, agents: AgentId[]): HarnessManifest {
  return {
    version: 1,
    project: { name: projectName },
    agents,
    resources: {
      skills: ['.agents/skills'],
      rules: ['.agents/rules'],
    },
    policies: { conflict: 'fail' },
  };
}

export function serializeManifest(manifest: HarnessManifest): string {
  return stringify(manifest, { lineWidth: 100 });
}

export async function diagnoseManifestSources(root: string, manifest: HarnessManifest): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const roots = [...manifest.resources.skills, ...manifest.resources.rules];
  for (const resourceRoot of roots) {
    let absolute: string;
    try {
      absolute = resolveInside(root, resourceRoot);
    } catch (error) {
      diagnostics.push({ level: 'error', code: 'PATH_OUTSIDE_PROJECT', message: error instanceof Error ? error.message : String(error), path: resourceRoot });
      continue;
    }
    if (!(await exists(absolute))) {
      diagnostics.push({ level: 'error', code: 'RESOURCE_ROOT_MISSING', message: `Resource root does not exist: ${resourceRoot}`, path: resourceRoot });
      continue;
    }
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      diagnostics.push({ level: 'error', code: 'SYMLINK_SOURCE_REJECTED', message: `Resource root cannot be a symlink: ${resourceRoot}`, path: resourceRoot });
    } else if (!stat.isDirectory()) {
      diagnostics.push({ level: 'error', code: 'RESOURCE_ROOT_NOT_DIRECTORY', message: `Resource root is not a directory: ${resourceRoot}`, path: resourceRoot });
    }
    if (path.resolve(absolute) === path.resolve(root)) {
      diagnostics.push({ level: 'error', code: 'RESOURCE_ROOT_TOO_BROAD', message: `Resource root cannot be the project root: ${resourceRoot}`, path: resourceRoot });
    }
  }
  return diagnostics;
}
