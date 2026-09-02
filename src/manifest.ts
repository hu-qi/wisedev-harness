import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';

export const SafeName = z.string().min(1).regex(/^[A-Za-z0-9._-]+$/, 'must contain only letters, digits, dot, underscore or dash');
export const RuntimeSchema = z.enum(['claude', 'codex', 'cursor']);
export const HookEventSchema = z.enum(['SessionStart', 'Stop', 'PostToolUse', 'UserPromptSubmit']);
export const ScopeSchema = z.enum(['project', 'user']);

const SkillMeta = {
  name: SafeName,
  required: z.boolean().default(true),
  roles: z.array(SafeName).default([]),
  tags: z.array(SafeName).default([])
};

const LocalSkillSchema = z.object({ ...SkillMeta, source: z.literal('local').default('local'), path: z.string().optional() });
const GitSkillSchema = z.object({ ...SkillMeta, source: z.literal('git'), url: z.string().url(), ref: z.string().min(1), path: z.string().optional() });
const SharedSkillSchema = z.object({ ...SkillMeta, source: z.literal('shared'), sourceName: SafeName, path: z.string().min(1) });
export const SkillSchema = z.union([LocalSkillSchema, GitSkillSchema, SharedSkillSchema]);

export const SharedSourceSchema = z.object({
  name: SafeName,
  url: z.string().url(),
  ref: z.string().min(1),
  required: z.boolean().default(true)
});

export const HookSchema = z.object({
  id: SafeName,
  description: z.string().min(1),
  event: HookEventSchema,
  command: z.string().min(1),
  matcher: z.string().default('*'),
  timeout: z.number().int().positive().max(600).optional(),
  runtimes: z.array(RuntimeSchema).optional()
});

const ExecutionPolicySchema = z.object({
  allow: z.array(z.string().min(1)).default([]),
  deny: z.array(z.string().min(1)).default([]),
  denyShellMetacharacters: z.boolean().default(false)
}).default({ allow: [], deny: [], denyShellMetacharacters: false });

export const ManifestSchema = z.object({
  version: z.literal(1),
  scope: ScopeSchema.default('project'),
  inheritUserScope: z.boolean().default(false),
  project: z.object({ name: z.string().min(1), root: z.string().default('.') }),
  runtimes: z.array(RuntimeSchema).min(1).default(['claude', 'codex']),
  sources: z.array(SharedSourceSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  rules: z.array(z.object({ path: z.string().min(1), required: z.boolean().default(true) })).default([]),
  hooks: z.array(HookSchema).default([]),
  policies: z.object({
    managedBlockId: z.string().min(1).default('wisedev-harness'),
    failOnMissingRequired: z.boolean().default(true),
    requireHookTrust: z.boolean().default(true),
    hookShell: z.enum(['sh']).default('sh'),
    execution: ExecutionPolicySchema,
    protectSymlinkEscapes: z.boolean().default(true),
    secretScan: z.boolean().default(true)
  }).default({
    managedBlockId: 'wisedev-harness', failOnMissingRequired: true, requireHookTrust: true, hookShell: 'sh',
    execution: { allow: [], deny: [], denyShellMetacharacters: false }, protectSymlinkEscapes: true, secretScan: true
  })
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type SharedSource = z.infer<typeof SharedSourceSchema>;
export type HookDef = z.infer<typeof HookSchema>;
export type RuntimeName = z.infer<typeof RuntimeSchema>;
export type HarnessScope = z.infer<typeof ScopeSchema>;
export const MANIFEST_PATH = '.agents/manifest.yaml';

export async function loadManifest(cwd = process.cwd()): Promise<Manifest> {
  const file = resolve(cwd, MANIFEST_PATH);
  const raw = await readFile(file, 'utf8');
  return ManifestSchema.parse(YAML.parse(raw));
}
export function defaultManifest(projectName: string, scope: HarnessScope = 'project'): Manifest {
  return ManifestSchema.parse({ version: 1, scope, project: { name: projectName }, runtimes: ['claude', 'codex'] });
}
export function serializeManifest(manifest: Manifest): string { return YAML.stringify(manifest); }
