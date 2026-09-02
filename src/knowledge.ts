import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const CURRENT_SESSION = '.agents/session-current.json';
const SESSION_DIR = '.agents/sessions';
const SUMMARY_DIR = '.agents/session-summaries';
const CANDIDATE_DIR = '.agents/learning-candidates';
const LEARNING_DIR = '.agents/learnings';

export type SessionEventType = 'note' | 'intervention' | 'tool_failure' | 'tool_denied' | 'retry';

const FRICTION_WEIGHTS: Record<SessionEventType, number> = {
  note: 0,
  intervention: 3,
  tool_failure: 2,
  tool_denied: 3,
  retry: 1
};

export interface SessionState { id: string; task: string; startedAt: string }
export interface SessionEvent { at: string; type: SessionEventType; message: string }
export interface SessionSummary {
  version: 1;
  id: string;
  task: string;
  startedAt: string;
  endedAt: string;
  eventCount: number;
  frictionScore: number;
  friction: Record<SessionEventType, number>;
}
export interface LearningCandidate { version: 1; id: string; sessionId: string; task: string; createdAt: string; frictionScore: number; signals: string[]; evidence: SessionEvent[] }
export interface Learning { version: 1; id: string; title: string; summary: string; tags: string[]; sourceSession?: string; createdAt: string }

export function redactText(input: string): string {
  return input
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{12,})\b/g, '[REDACTED]')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|token)\b(\s*[:=]\s*)([^\s,;]+)/gi, '$1$2[REDACTED]');
}

function safeName(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return cleaned || 'learning';
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

async function readCurrent(cwd: string): Promise<SessionState> {
  try { return JSON.parse(await readFile(resolve(cwd, CURRENT_SESSION), 'utf8')) as SessionState; }
  catch (error: any) { if (error?.code === 'ENOENT') throw new Error('No active session. Run `wisedev-harness session start <task>` first.'); throw error; }
}

export async function startSession(task: string, cwd = process.cwd()): Promise<SessionState> {
  const state: SessionState = { id: randomUUID(), task: redactText(task), startedAt: new Date().toISOString() };
  await writeJson(resolve(cwd, CURRENT_SESSION), state);
  await mkdir(resolve(cwd, SESSION_DIR), { recursive: true });
  return state;
}

export async function recordSessionEvent(type: SessionEventType, message: string, cwd = process.cwd()): Promise<SessionEvent> {
  const state = await readCurrent(cwd);
  if (!(type in FRICTION_WEIGHTS)) throw new Error(`Unsupported session event type '${type}'.`);
  const event: SessionEvent = { at: new Date().toISOString(), type, message: redactText(message) };
  await mkdir(resolve(cwd, SESSION_DIR), { recursive: true });
  await appendFile(resolve(cwd, SESSION_DIR, `${state.id}.jsonl`), JSON.stringify(event) + '\n');
  return event;
}

async function readEvents(id: string, cwd: string): Promise<SessionEvent[]> {
  try {
    const raw = await readFile(resolve(cwd, SESSION_DIR, `${id}.jsonl`), 'utf8');
    return raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as SessionEvent);
  } catch (error: any) { if (error?.code === 'ENOENT') return []; throw error; }
}

export async function endSession(cwd = process.cwd(), threshold = 5): Promise<{ summary: SessionSummary; candidate?: LearningCandidate }> {
  const state = await readCurrent(cwd);
  const events = await readEvents(state.id, cwd);
  const friction = { note: 0, intervention: 0, tool_failure: 0, tool_denied: 0, retry: 0 } as Record<SessionEventType, number>;
  let frictionScore = 0;
  for (const event of events) { friction[event.type] += 1; frictionScore += FRICTION_WEIGHTS[event.type]; }
  const summary: SessionSummary = { version: 1, ...state, endedAt: new Date().toISOString(), eventCount: events.length, frictionScore, friction };
  await writeJson(resolve(cwd, SUMMARY_DIR, `${state.id}.json`), summary);
  let candidate: LearningCandidate | undefined;
  if (frictionScore >= threshold) {
    candidate = {
      version: 1,
      id: state.id,
      sessionId: state.id,
      task: state.task,
      createdAt: new Date().toISOString(),
      frictionScore,
      signals: Object.entries(friction).filter(([, count]) => count > 0).map(([type, count]) => `${type}:${count}`),
      evidence: events.filter(event => FRICTION_WEIGHTS[event.type] > 0).slice(-20)
    };
    await writeJson(resolve(cwd, CANDIDATE_DIR, `${state.id}.json`), candidate);
  }
  await rm(resolve(cwd, CURRENT_SESSION), { force: true });
  return { summary, candidate };
}

export async function listLearningCandidates(cwd = process.cwd()): Promise<LearningCandidate[]> {
  const dir = resolve(cwd, CANDIDATE_DIR);
  try {
    const files = (await readdir(dir)).filter(file => file.endsWith('.json')).sort();
    return Promise.all(files.map(async file => JSON.parse(await readFile(join(dir, file), 'utf8')) as LearningCandidate));
  } catch (error: any) { if (error?.code === 'ENOENT') return []; throw error; }
}

export async function promoteLearning(candidateId: string, title: string, summary: string, tags: string[], cwd = process.cwd()): Promise<string> {
  const path = resolve(cwd, CANDIDATE_DIR, `${basename(candidateId, '.json')}.json`);
  const candidate = JSON.parse(await readFile(path, 'utf8')) as LearningCandidate;
  const learning: Learning = {
    version: 1,
    id: randomUUID(),
    title: redactText(title),
    summary: redactText(summary),
    tags: tags.map(redactText),
    sourceSession: candidate.sessionId,
    createdAt: new Date().toISOString()
  };
  const filename = `${safeName(title)}-${learning.id.slice(0, 8)}.json`;
  await writeJson(resolve(cwd, LEARNING_DIR, filename), learning);
  return filename;
}

export async function addLearning(title: string, summary: string, tags: string[], cwd = process.cwd()): Promise<string> {
  const learning: Learning = { version: 1, id: randomUUID(), title: redactText(title), summary: redactText(summary), tags: tags.map(redactText), createdAt: new Date().toISOString() };
  const filename = `${safeName(title)}-${learning.id.slice(0, 8)}.json`;
  await writeJson(resolve(cwd, LEARNING_DIR, filename), learning);
  return filename;
}

function terms(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}._-]+/u).filter(term => term.length >= 2));
}

export async function recallLearnings(query: string, cwd = process.cwd(), limit = 5): Promise<Array<{ file: string; learning: Learning; score: number; matched: string[] }>> {
  const q = terms(query);
  const dir = resolve(cwd, LEARNING_DIR);
  let files: string[];
  try { files = (await readdir(dir)).filter(file => file.endsWith('.json')); }
  catch (error: any) { if (error?.code === 'ENOENT') return []; throw error; }
  const scored = await Promise.all(files.map(async file => {
    const learning = JSON.parse(await readFile(join(dir, file), 'utf8')) as Learning;
    const title = terms(learning.title); const tagTerms = terms(learning.tags.join(' ')); const body = terms(learning.summary);
    const matched = [...q].filter(term => title.has(term) || tagTerms.has(term) || body.has(term));
    const score = matched.reduce((sum, term) => sum + (title.has(term) ? 4 : 0) + (tagTerms.has(term) ? 3 : 0) + (body.has(term) ? 1 : 0), 0);
    return { file, learning, score, matched };
  }));
  return scored.filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.learning.createdAt.localeCompare(a.learning.createdAt)).slice(0, Math.max(1, limit));
}
