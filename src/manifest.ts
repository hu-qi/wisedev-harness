import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';

export const RuntimeSchema = z.enum(['claude', 'codex', 'cursor']);

export const ManifestSchema = z.object({
  version: z.literal(1),
  project: z.object({
    name: z.string().min(1),
    root: z.string().default('.')
  }),
  runtimes: z.array(RuntimeSchema).min(1).default(['claude', 'codex']),
  skills: z.array(z.object({
    name: z.string().min(1),
    source: z.enum(['local', 'git']).default('local'),
    path: z.string().optional(),
    url: z.string().url().optional(),
    required: z.boolean().default(true)
  })).default([]),
  rules: z.array(z.object({
    path: z.string().min(1),
    required: z.boolean().default(true)
  })).default([]),
  policies: z.object({
    managedBlockId: z.string().min(1).default('wisedev-harness'),
    failOnMissingRequired: z.boolean().default(true)
  }).default({ managedBlockId: 'wisedev-harness', failOnMissingRequired: true })
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type RuntimeName = z.infer<typeof RuntimeSchema>;

export const MANIFEST_PATH = '.agents/manifest.yaml';

export async function loadManifest(cwd = process.cwd()): Promise<Manifest> {
  const file = resolve(cwd, MANIFEST_PATH);
  const raw = await readFile(file, 'utf8');
  return ManifestSchema.parse(YAML.parse(raw));
}

export function defaultManifest(projectName: string): Manifest {
  return ManifestSchema.parse({ version: 1, project: { name: projectName }, runtimes: ['claude', 'codex'] });
}

export function serializeManifest(manifest: Manifest): string {
  return YAML.stringify(manifest);
}
