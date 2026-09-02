import { homedir } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { loadManifest, ManifestSchema, type HarnessScope, type Manifest, type Skill } from './manifest.js';

const ProfileSchema = z.object({
  roles: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([])
});

export type SelectionProfile = z.infer<typeof ProfileSchema>;
export interface ResolutionEntry { kind: 'skill' | 'source' | 'rule'; name: string; origin: 'user' | 'project'; selected: boolean; reason: string }
export interface EffectiveManifestResult { manifest: Manifest; profile: SelectionProfile; entries: ResolutionEntry[] }

export function userScopeRoot(home = homedir()): string { return resolve(home, '.wisedev-harness'); }
export function scopeRoot(scope: HarnessScope, cwd = process.cwd(), home = homedir()): string { return scope === 'user' ? userScopeRoot(home) : resolve(cwd); }
export function profilePath(root: string): string { return resolve(root, '.agents/profile.yaml'); }

export async function loadProfile(root: string): Promise<SelectionProfile> {
  try { return ProfileSchema.parse(YAML.parse(await readFile(profilePath(root), 'utf8'))); }
  catch (error: any) { if (error?.code === 'ENOENT') return ProfileSchema.parse({}); throw error; }
}

async function ensureProfileIgnored(root: string): Promise<void> {
  const path = resolve(root, '.agents/.gitignore');
  let lines: string[] = [];
  try { lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean); }
  catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  if (!lines.includes('profile.yaml')) lines.push('profile.yaml');
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
}

export async function saveProfile(root: string, profile: SelectionProfile): Promise<void> {
  const value = ProfileSchema.parse(profile);
  await mkdir(resolve(root, '.agents'), { recursive: true });
  await ensureProfileIgnored(root);
  await writeFile(profilePath(root), YAML.stringify(value), 'utf8');
}

function union(a: string[], b: string[]): string[] { return [...new Set([...a, ...b])].sort(); }
function dimensionMatches(required: string[], selected: string[]): boolean { return required.length === 0 || required.some(value => selected.includes(value)); }

export function skillSelected(skill: Skill, profile: SelectionProfile): { selected: boolean; reason: string } {
  const roleMatch = dimensionMatches(skill.roles, profile.roles);
  const tagMatch = dimensionMatches(skill.tags, profile.tags);
  if (!roleMatch) return { selected: false, reason: `role mismatch: requires one of [${skill.roles.join(', ')}]` };
  if (!tagMatch) return { selected: false, reason: `tag mismatch: requires one of [${skill.tags.join(', ')}]` };
  const constraints = [skill.roles.length ? `roles=${skill.roles.join(',')}` : '', skill.tags.length ? `tags=${skill.tags.join(',')}` : ''].filter(Boolean);
  return { selected: true, reason: constraints.length ? `matched ${constraints.join(' ')}` : 'unconstrained' };
}

function normalizeUserSkill(skill: Skill, userRoot: string): Skill {
  if (skill.source !== 'local') return skill;
  return { ...skill, path: resolve(userRoot, skill.path ?? `.agents/skills/${skill.name}`) };
}

async function loadUserManifest(home: string): Promise<{ root: string; manifest: Manifest }> {
  const root = userScopeRoot(home);
  const manifest = await loadManifest(root);
  if (manifest.scope !== 'user') throw new Error(`User-scope manifest at ${root} must declare scope: user.`);
  return { root, manifest };
}

export async function loadEffectiveManifest(cwd = process.cwd(), home = homedir()): Promise<EffectiveManifestResult> {
  const project = await loadManifest(cwd);
  if (project.scope !== 'project') throw new Error(`Project manifest must declare scope: project; found '${project.scope}'.`);

  const projectProfile = await loadProfile(cwd);
  let profile = projectProfile;
  const entries: ResolutionEntry[] = [];
  const sourceMap = new Map<string, { value: Manifest['sources'][number]; origin: 'user' | 'project' }>();
  const skillMap = new Map<string, { value: Skill; origin: 'user' | 'project' }>();
  const rules: Manifest['rules'] = [];

  if (project.inheritUserScope) {
    let user;
    try { user = await loadUserManifest(home); }
    catch (error: any) {
      if (error?.code === 'ENOENT') throw new Error('Project requests inheritUserScope but no user-scope manifest exists. Run `wisedev-harness --scope user init`.');
      throw error;
    }
    const userProfile = await loadProfile(user.root);
    profile = { roles: union(userProfile.roles, projectProfile.roles), tags: union(userProfile.tags, projectProfile.tags) };
    for (const source of user.manifest.sources) sourceMap.set(source.name, { value: source, origin: 'user' });
    for (const skill of user.manifest.skills) skillMap.set(skill.name, { value: normalizeUserSkill(skill, user.root), origin: 'user' });
    for (const rule of user.manifest.rules) {
      const path = resolve(user.root, rule.path);
      rules.push({ ...rule, path });
      entries.push({ kind: 'rule', name: path, origin: 'user', selected: true, reason: 'inherited safe user rule' });
    }
  }

  for (const source of project.sources) sourceMap.set(source.name, { value: source, origin: 'project' });
  for (const skill of project.skills) skillMap.set(skill.name, { value: skill, origin: 'project' });
  for (const rule of project.rules) {
    rules.push(rule);
    entries.push({ kind: 'rule', name: rule.path, origin: 'project', selected: true, reason: 'project rule' });
  }

  const sources = [...sourceMap.entries()].map(([name, item]) => {
    entries.push({ kind: 'source', name, origin: item.origin, selected: true, reason: item.origin === 'project' ? 'project source takes precedence for this name' : 'inherited user source' });
    return item.value;
  });
  const skills: Skill[] = [];
  for (const [name, item] of skillMap) {
    const decision = skillSelected(item.value, profile);
    entries.push({ kind: 'skill', name, origin: item.origin, selected: decision.selected, reason: decision.reason });
    if (decision.selected) skills.push(item.value);
  }

  const manifest = ManifestSchema.parse({
    ...project,
    scope: 'project',
    sources,
    skills,
    rules,
    // Execution-bearing resources always remain project-owned when inheriting user scope.
    hooks: project.hooks,
    policies: project.policies
  });
  return { manifest, profile, entries };
}

export async function loadManifestForScope(scope: HarnessScope, cwd = process.cwd(), home = homedir()): Promise<{ root: string; manifest: Manifest }> {
  const root = scopeRoot(scope, cwd, home);
  if (scope === 'project') return { root, manifest: (await loadEffectiveManifest(cwd, home)).manifest };
  const manifest = await loadManifest(root);
  if (manifest.scope !== 'user') throw new Error(`Expected user-scope manifest at ${root}, found '${manifest.scope}'.`);
  const profile = await loadProfile(root);
  return { root, manifest: ManifestSchema.parse({ ...manifest, skills: manifest.skills.filter(skill => skillSelected(skill, profile).selected) }) };
}

export async function scopeStatus(cwd = process.cwd(), home = homedir()): Promise<string[]> {
  const project = await loadManifest(cwd);
  const lines = [`project\t${resolve(cwd)}\tinheritUserScope=${project.inheritUserScope}`];
  try {
    const user = await loadUserManifest(home);
    lines.push(`user\t${user.root}\t${user.manifest.project.name}`);
  } catch { lines.push(`user\t${userScopeRoot(home)}\tnot initialized`); }
  return lines;
}

export function defaultScopeName(scope: HarnessScope, root: string): string { return scope === 'user' ? 'user' : basename(root); }
