#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { applyAdapters } from './adapters.js';
import { checkHarness, hasFailures, initHarness, verifyHarness } from './core.js';
import { diffHarness, listSnapshots, pullHarness, rollbackHarness } from './distribution.js';
import { applyEvolution, approveEvolution, evaluateEvolution, evolutionDiff, proposeEvolution, readEvolutionCandidate, rollbackEvolution } from './evolution.js';
import { injectHooks, listHooks, removeHooks, runHook } from './hooks.js';
import { addLearning, endSession, listLearningCandidates, promoteLearning, recallLearnings, recordSessionEvent, startSession, type SessionEventType } from './knowledge.js';
import { loadManifest } from './manifest.js';
import { isManifestTrusted, revokeTrust, trustManifest } from './trust.js';

const program = new Command();
program.name('wisedev-harness').description('WiseDev agent harness runtime and verification CLI').version('0.5.0');

function print(checks: Awaited<ReturnType<typeof checkHarness>>) {
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  ${c.detail}`);
  if (hasFailures(checks)) process.exitCode = 1;
}
program.command('init').description('Initialize project harness without clobbering existing agent instructions').option('--force', 'replace the manifest; managed agent blocks remain merge-safe').action(async opts => { const result = await initHarness(process.cwd(), Boolean(opts.force)); console.log(`Initialized ${result.manifestPath}`); for (const file of result.touched) console.log(`Managed ${file}`); });
program.command('check').description('Validate environment, manifest and required resources').action(async () => print(await checkHarness()));
program.command('verify').description('Run check plus runtime adapter integrity verification').action(async () => print(await verifyHarness()));
program.command('pull').description('Install git skills at versions pinned in the lockfile; resolve only missing pins').action(async () => { const lock = await pullHarness(await loadManifest(), process.cwd(), false); for (const [name, item] of Object.entries(lock.skills)) console.log(`SYNC  ${name}  ${item.resolved.slice(0, 12)}  ${item.target}`); });
program.command('update').description('Resolve configured git refs again, install them, and update the lockfile').action(async () => { const lock = await pullHarness(await loadManifest(), process.cwd(), true); for (const [name, item] of Object.entries(lock.skills)) console.log(`UPDATE  ${name}  ${item.resolved.slice(0, 12)}  ${item.target}`); });
program.command('diff').description('Compare locked git skills with current configured refs without installing changes').action(async () => { const entries = await diffHarness(await loadManifest()); for (const item of entries) console.log(`${item.status.toUpperCase()}  ${item.name}${item.locked ? `  locked=${item.locked.slice(0, 12)}` : ''}${item.remote ? `  remote=${item.remote.slice(0, 12)}` : ''}`); if (entries.some(item => item.status !== 'current')) process.exitCode = 2; });
program.command('snapshots').description('List saved lockfile snapshots').action(async () => { for (const name of await listSnapshots()) console.log(name); });
program.command('rollback [snapshot]').description('Restore git skills from a previous lockfile snapshot').action(async snapshot => console.log(`Rolled back using ${await rollbackHarness(await loadManifest(), process.cwd(), snapshot)}`));

program.command('trust').description('Trust the exact current manifest fingerprint for command hooks/evals').action(async () => console.log(`Trusted manifest ${(await trustManifest()).manifestSha256}`));
program.command('untrust').description('Revoke local hook/eval execution trust').action(async () => { await revokeTrust(); console.log('Manifest execution trust revoked.'); });
program.command('trust-status').description('Show whether the exact current manifest is trusted').action(async () => { const trusted = await isManifestTrusted(); console.log(trusted ? 'TRUSTED' : 'UNTRUSTED'); if (!trusted) process.exitCode = 3; });

const hooks = program.command('hooks').description('Manage runtime hook integration');
hooks.command('inject').description('Reconcile WiseDev hooks into enabled runtime hook files').action(async () => { for (const file of await injectHooks(await loadManifest())) console.log(`Managed ${file}`); console.log('Note: Codex may require explicit hook trust in its own UI in addition to WiseDev manifest trust.'); });
hooks.command('remove').description('Remove only WiseDev-managed runtime hooks').action(async () => { for (const file of await removeHooks(await loadManifest())) console.log(`Cleaned ${file}`); });
hooks.command('list').description('List declarative hooks from the manifest').action(async () => { for (const line of listHooks(await loadManifest())) console.log(line); });
program.command('hook-run <id>').description('Internal trusted hook dispatcher').action(async id => { const status = await runHook(await loadManifest(), id); if (status !== 0) process.exitCode = status; });

const session = program.command('session').description('Record privacy-scrubbed execution evidence and friction');
session.command('start <task...>').description('Start a local auditable session').action(async task => { const state = await startSession(task.join(' ')); console.log(`SESSION ${state.id}`); });
session.command('record').description('Record a redacted session event').requiredOption('--type <type>', 'note|intervention|tool_failure|tool_denied|retry').requiredOption('--message <message>').action(async opts => { const event = await recordSessionEvent(opts.type as SessionEventType, opts.message); console.log(`${event.type.toUpperCase()} ${event.at}`); });
session.command('end').description('End session, score friction and create a learning candidate when warranted').option('--threshold <score>', 'candidate threshold', '5').action(async opts => { const { summary, candidate } = await endSession(process.cwd(), Number(opts.threshold)); console.log(`FRICTION ${summary.frictionScore} events=${summary.eventCount}`); if (candidate) console.log(`LEARNING_CANDIDATE ${candidate.id}`); });

const learning = program.command('learning').description('Manage reviewable team learnings');
learning.command('candidates').description('List friction-generated learning candidates').action(async () => { for (const item of await listLearningCandidates()) console.log(`${item.id}\tfriction=${item.frictionScore}\t${item.task}`); });
learning.command('promote <candidate>').description('Promote a candidate into a tracked learning').requiredOption('--title <title>').requiredOption('--summary <summary>').option('--tags <tags>', 'comma-separated tags', '').action(async (candidate, opts) => console.log(`CREATED ${await promoteLearning(candidate, opts.title, opts.summary, opts.tags.split(',').filter(Boolean))}`));
learning.command('add').description('Add a reviewed learning directly').requiredOption('--title <title>').requiredOption('--summary <summary>').option('--tags <tags>', 'comma-separated tags', '').action(async opts => console.log(`CREATED ${await addLearning(opts.title, opts.summary, opts.tags.split(',').filter(Boolean))}`));
program.command('recall <query...>').description('Search tracked learnings with explainable lexical ranking').option('--limit <n>', 'maximum results', '5').action(async (query, opts) => { for (const item of await recallLearnings(query.join(' '), process.cwd(), Number(opts.limit))) console.log(`${item.score}\t${item.file}\tmatched=${item.matched.join(',')}\t${item.learning.title}\n  ${item.learning.summary}`); });

const evolve = program.command('evolve').description('Evaluate, approve, apply and roll back Harness evolution candidates');
evolve.command('propose <target>').requiredOption('--content-file <path>').requiredOption('--reason <reason>').option('--source-learning <id>').action(async (target, opts) => { const content = await readFile(opts.contentFile, 'utf8'); const candidate = await proposeEvolution(target, content, opts.reason, opts.sourceLearning); console.log(`CANDIDATE ${candidate.id} target=${candidate.target}`); });
evolve.command('diff <id>').action(async id => { const candidate = await readEvolutionCandidate(id); let current = ''; try { current = await readFile(candidate.target, 'utf8'); } catch {} const diff = evolutionDiff(candidate, current); console.log(`baselineLines=${diff.baselineLines} candidateLines=${diff.candidateLines} changedLines=${diff.changedLineCount} baseMatchesCurrent=${diff.baseMatchesCurrent}`); });
evolve.command('evaluate <id>').requiredOption('--command <command>').action(async (id, opts) => { const result = await evaluateEvolution(id, opts.command); console.log(`${result.passed ? 'PASS' : 'FAIL'} exit=${result.exitCode}`); if (result.stdout) console.log(result.stdout); if (result.stderr) console.error(result.stderr); if (!result.passed) process.exitCode = 4; });
evolve.command('approve <id>').action(async id => { const candidate = await approveEvolution(id); console.log(`APPROVED ${candidate.id}`); });
evolve.command('apply <id>').action(async id => { const candidate = await applyEvolution(id); console.log(`APPLIED ${candidate.id} -> ${candidate.target}`); });
evolve.command('rollback <id>').action(async id => { const candidate = await rollbackEvolution(id); console.log(`ROLLED_BACK ${candidate.id} -> ${candidate.target}`); });

program.command('doctor').description('Diagnose and reconcile generated runtime adapter blocks').option('--fix', 'rewrite managed runtime blocks').action(async opts => { const before = await verifyHarness(); print(before); if (opts.fix && hasFailures(before)) { const manifest = await loadManifest(); for (const file of await applyAdapters(manifest)) console.log(`Reconciled ${file}`); process.exitCode = hasFailures(await verifyHarness()) ? 1 : 0; } });
program.parseAsync(process.argv).catch(error => { console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
