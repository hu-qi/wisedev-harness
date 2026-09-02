import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Learning } from './knowledge.js';
import { recallLearnings } from './knowledge.js';
import type { RecallBackendName } from './manifest.js';

export interface RecallResult { file: string; learning: Learning; score: number; matched: string[] }
export interface RecallRequest { query: string; cwd: string; limit: number; indexPath?: string }
export interface RecallBackend { name: string; search(request: RecallRequest): Promise<RecallResult[]> }

const registry = new Map<string, RecallBackend>();

function terms(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}._-]+/u).filter(term => term.length >= 2));
}
function scoreLearning(query: Set<string>, learning: Learning): { score: number; matched: string[] } {
  const title = terms(learning.title);
  const tagTerms = terms(learning.tags.join(' '));
  const body = terms(learning.summary);
  const matched = [...query].filter(term => title.has(term) || tagTerms.has(term) || body.has(term));
  const score = matched.reduce((sum, term) => sum + (title.has(term) ? 4 : 0) + (tagTerms.has(term) ? 3 : 0) + (body.has(term) ? 1 : 0), 0);
  return { score, matched };
}

const lexicalBackend: RecallBackend = {
  name: 'lexical',
  search: request => recallLearnings(request.query, request.cwd, request.limit)
};

const jsonIndexBackend: RecallBackend = {
  name: 'json-index',
  async search(request) {
    const indexPath = request.indexPath ?? '.agents/recall-index.json';
    if (indexPath.startsWith('/') || indexPath === '..' || indexPath.includes('../') || indexPath.includes('\\..\\')) throw new Error(`Unsafe Recall index path '${indexPath}'.`);
    const root = resolve(request.cwd);
    const path = resolve(root, indexPath);
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error(`Recall index path escapes scope root: ${indexPath}`);
    let raw: unknown;
    try { raw = JSON.parse(await readFile(path, 'utf8')); }
    catch (error: any) { if (error?.code === 'ENOENT') return []; throw new Error(`Invalid Recall JSON index '${indexPath}': ${error?.message ?? String(error)}`); }
    if (!Array.isArray(raw)) throw new Error(`Recall JSON index '${indexPath}' must contain an array.`);
    const queryTerms = terms(request.query);
    const out: RecallResult[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const value = raw[i] as Partial<Learning>;
      if (value.version !== 1 || typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.summary !== 'string' || !Array.isArray(value.tags) || typeof value.createdAt !== 'string') {
        throw new Error(`Recall JSON index '${indexPath}' has an invalid Learning at index ${i}.`);
      }
      const learning = value as Learning;
      const scored = scoreLearning(queryTerms, learning);
      if (scored.score > 0) out.push({ file: `${indexPath}#${i}`, learning, ...scored });
    }
    return out.sort((a, b) => b.score - a.score || b.learning.createdAt.localeCompare(a.learning.createdAt)).slice(0, Math.max(1, request.limit));
  }
};

registry.set(lexicalBackend.name, lexicalBackend);
registry.set(jsonIndexBackend.name, jsonIndexBackend);

export function registerRecallBackend(backend: RecallBackend): void {
  if (!backend.name || !/^[A-Za-z0-9._-]+$/.test(backend.name)) throw new Error(`Invalid Recall backend name '${backend.name}'.`);
  if (registry.has(backend.name)) throw new Error(`Recall backend '${backend.name}' is already registered.`);
  registry.set(backend.name, backend);
}

export function getRecallBackend(name: string): RecallBackend {
  const backend = registry.get(name);
  if (!backend) throw new Error(`Unknown Recall backend '${name}'. Registered: ${[...registry.keys()].sort().join(', ')}`);
  return backend;
}

export function recallBackendLines(): string[] {
  return [...registry.keys()].sort().map(name => `${name}\t${name === 'lexical' ? 'tracked .agents/learnings lexical ranking' : name === 'json-index' ? 'local prebuilt JSON Learning index' : 'registered in-process backend'}`);
}

export async function recallWithBackend(backendName: RecallBackendName | string, request: RecallRequest): Promise<RecallResult[]> {
  return getRecallBackend(backendName).search(request);
}
