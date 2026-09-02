#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { applyAdapters } from './adapters.js';
import { exportOfflineBundle, importOfflineBundle } from './bundle.js';
import { capabilityLines } from './capabilities.js';
import { checkHarness, hasFailures, initHarness, verifyHarness } from './core.js';
import { diffHarness, listSnapshots, pullHarness, rollbackHarness } from './distribution.js';
import { buildHealthSummary, emitTelemetry, explainCommandPolicy, exportAuditBundle, readTelemetryConfig, setTelemetry } from './enterprise.js';
import { applyEvolution, approveEvolution, evaluateEvolution, evolutionDiff, proposeEvolution, readEvolutionCandidate, rollbackEvolution } from './evolution.js';
import { injectHooks, listHooks, removeHooks, runHook } from './hooks.js';
import { addLearning, endSession, listLearningCandidates, promoteLearning, recallLearnings, recordSessionEvent, startSession, type SessionEventType } from './knowledge.js';
import { loadManifest, ScopeSchema, type HarnessScope } from './manifest.js';
import { evaluateCommandPolicy, scanFileSecrets } from './security.js';
import { loadEffectiveManifest, loadManifestForScope, loadProfile, saveProfile, scopeRoot, scopeStatus, userScopeRoot } from './team.js';
import { isManifestTrusted, revokeTrust, trustManifest } from './trust.js';

const packageVersion = (JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const program = new Command();
program
  .name('wisedev-harness')
  .description('WiseDev agent harness runtime, distribution, policy, knowledge and evolution CLI')
  .version(packageVersion)
  .option('--scope <scope>', 'resource scope: project or user', 'project');

function selectedScope(): HarnessScope { return ScopeSchema.parse(program.opts().scope); }
function requireProjectScope(): void { if (selectedScope() !== 'project') throw new Error('This command is project-scope only because it can affect project execution behavior.'); }
function csv(value?: string): string[] { return (value ?? '').split(',').map(item => item.trim()).filter(Boolean); }

function print(checks: Awaited<ReturnType<typeof checkHarness>>) {
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  ${c.detail}`);
  if (hasFailures(checks)) process.exitCode = 1;
}

async function selectedContext() { return loadManifestForScope(selectedScope()); }

program.command('init')
  .description('Initialize the selected scope without clobbering existing project instructions')
  .option('--force', 'replace an existing manifest; managed blocks remain merge-safe')
  .action(async opts => {
    const scope = selectedScope();
    const root = scopeRoot(scope);
    const result = await initHarness(root, Boolean(opts.force), { scope, applyRuntimeAdapters: scope === 'project' });
    console.log(`Initialized ${scope} scope at ${result.manifestPath}`);
    for (const file of result.touched) console.log(`Managed ${file}`);
    if (scope === 'user') console.log(`User scope root: ${root}`);
  });

program.command('check').description('Validate environment, effective manifest and selected resources').action(async () => {
  const { root, manifest } = await selectedContext();
  print(await checkHarness(root, manifest));
});

program.command('verify').description('Run checks plus runtime adapter integrity when using project scope').action(async () => {
  const scope = selectedScope();
  const { root, manifest } = await selectedContext();
  print(await verifyHarness(root, manifest, scope === 'project'));
});

program.command('pull').description('Install selected remote Skills at lock-pinned versions; resolve only missing pins').action(async () => {
  const { root, manifest } = await selectedContext();
  const lock = await pullHarness(manifest, root, false);
  for (const [name, item] of Object.entries(lock.skills)) console.log(`SYNC  ${name}  ${item.resolved.slice(0, 12)}  ${item.target}`);
});

program.command('update').description('Resolve selected remote Skill refs again and update the scope lockfile').action(async () => {
  const { root, manifest } = await selectedContext();
  const lock = await pullHarness(manifest, root, true);
  for (const [name, item] of Object.entries(lock.skills)) console.log(`UPDATE  ${name}  ${item.resolved.slice(0, 12)}  ${item.target}`);
});

program.command('diff').description('Compare selected locked Skills with configured refs without installing changes').action(async () => {
  const { root, manifest } = await selectedContext();
  const entries = await diffHarness(manifest, root);
  for (const item of entries) console.log(`${item.status.toUpperCase()}  ${item.name}${item.locked ? `  locked=${item.locked.slice(0, 12)}` : ''}${item.remote ? `  remote=${item.remote.slice(0, 12)}` : ''}`);
  if (entries.some(item => item.status !== 'current')) process.exitCode = 2;
});

program.command('snapshots').description('List saved lockfile snapshots for the selected scope').action(async () => {
  const root = scopeRoot(selectedScope());
  for (const name of await listSnapshots(root)) console.log(name);
});

program.command('rollback [snapshot]').description('Restore selected scope remote Skills from a previous lock snapshot').action(async snapshot => {
  const { root, manifest } = await selectedContext();
  console.log(`Rolled back using ${await rollbackHarness(manifest, root, snapshot)}`);
});

const scopeCommand = program.command('scope').description('Inspect project/user scope layering');
scopeCommand.command('status').description('Show project and user scope locations/status').action(async () => {
  for (const line of await scopeStatus()) console.log(line);
});
scopeCommand.command('resolve').description('Explain the effective project resource selection and override decisions').action(async () => {
  requireProjectScope();
  const result = await loadEffectiveManifest();
  console.log(`PROFILE roles=${result.profile.roles.join(',') || '-'} tags=${result.profile.tags.join(',') || '-'}`);
  for (const item of result.entries) console.log(`${item.selected ? 'SELECT' : 'SKIP'}\t${item.kind}\t${item.name}\torigin=${item.origin}\t${item.reason}`);
});

const profile = program.command('profile').description('Manage local untracked role/tag selection for the selected scope');
profile.command('show').action(async () => {
  const root = scopeRoot(selectedScope());
  const value = await loadProfile(root);
  console.log(`roles=${value.roles.join(',') || '-'}\ntags=${value.tags.join(',') || '-'}`);
});
profile.command('set')
  .option('--roles <roles>', 'comma-separated role ids')
  .option('--tags <tags>', 'comma-separated tags')
  .action(async opts => {
    const root = scopeRoot(selectedScope());
    const before = await loadProfile(root);
    const value = { roles: opts.roles === undefined ? before.roles : csv(opts.roles), tags: opts.tags === undefined ? before.tags : csv(opts.tags) };
    await saveProfile(root, value);
    console.log(`PROFILE roles=${value.roles.join(',') || '-'} tags=${value.tags.join(',') || '-'}`);
  });
profile.command('clear').action(async () => {
  const root = scopeRoot(selectedScope());
  await saveProfile(root, { roles: [], tags: [] });
  console.log('PROFILE roles=- tags=-');
});

const cache = program.command('cache').description('Export/import verified offline Skill bundles for the selected scope');
cache.command('export <file>').description('Export lock-pinned installed Skills into a gzip offline bundle').action(async file => {
  const root = scopeRoot(selectedScope());
  const result = await exportOfflineBundle(file, root);
  console.log(`EXPORTED ${result.skills} Skills -> ${result.output}`);
});
cache.command('import <file>').description('Import and hash-verify an offline bundle without network access').action(async file => {
  const root = scopeRoot(selectedScope());
  const result = await importOfflineBundle(file, root);
  console.log(`IMPORTED ${result.skills} Skills <- ${result.input}`);
});

program.command('capabilities').description('Show supported runtime adapter capabilities').action(() => {
  for (const line of capabilityLines()) console.log(line);
});

program.command('health').description('Summarize local Harness friction, security and learning health for the selected scope').option('--json', 'print machine-readable JSON').action(async opts => {
  const root = scopeRoot(selectedScope());
  const health = await buildHealthSummary(root);
  if (opts.json) { console.log(JSON.stringify(health, null, 2)); return; }
  console.log(`${health.status.toUpperCase()} sessions=${health.sessions} frictionAvg=${health.frictionAverage} highFriction=${health.highFrictionSessions} denied=${health.deniedSecurityEvents} learnings=${health.learningCount} pending=${health.pendingLearningCandidates}`);
  for (const reason of health.reasons) console.log(`REASON  ${reason}`);
});

const audit = program.command('audit').description('Export privacy-bounded structured Harness audit evidence');
audit.command('export <file>').description('Export manifest/lock/session summaries/security decisions/learnings/health as gzip JSON').action(async file => {
  const { root, manifest } = await selectedContext();
  console.log(`EXPORTED ${await exportAuditBundle(file, manifest, root)}`);
});

const telemetry = program.command('telemetry').description('Manage opt-in local structured telemetry for the selected scope');
telemetry.command('status').action(async () => {
  const root = scopeRoot(selectedScope());
  const value = await readTelemetryConfig(root);
  console.log(`${value.enabled ? 'ENABLED' : 'DISABLED'} includeProjectName=${value.includeProjectName}`);
});
telemetry.command('enable').option('--include-project-name', 'include project name in local telemetry events').action(async opts => {
  const root = scopeRoot(selectedScope());
  const value = await setTelemetry(true, Boolean(opts.includeProjectName), root);
  console.log(`ENABLED includeProjectName=${value.includeProjectName}`);
});
telemetry.command('disable').action(async () => {
  const root = scopeRoot(selectedScope());
  await setTelemetry(false, false, root);
  console.log('DISABLED');
});

program.command('trust').description('Trust the exact current project manifest fingerprint for command hooks/evals').action(async () => {
  requireProjectScope();
  console.log(`Trusted manifest ${(await trustManifest()).manifestSha256}`);
});
program.command('untrust').description('Revoke local project hook/eval execution trust').action(async () => {
  requireProjectScope();
  await revokeTrust();
  console.log('Manifest execution trust revoked.');
});
program.command('trust-status').description('Show whether the exact current project manifest is trusted').action(async () => {
  requireProjectScope();
  const trusted = await isManifestTrusted();
  console.log(trusted ? 'TRUSTED' : 'UNTRUSTED');
  if (!trusted) process.exitCode = 3;
});

const security = program.command('security').description('Inspect project execution policy and secret-scan files');
security.command('policy <command...>').description('Evaluate a shell command against the project execution policy without running it').action(async command => {
  requireProjectScope();
  const value = command.join(' ');
  const decision = evaluateCommandPolicy(value, await loadManifest());
  console.log(`${decision.allowed ? 'ALLOW' : 'DENY'}  ${value}\n${decision.reason}`);
  if (!decision.allowed) process.exitCode = 6;
});
security.command('explain <command...>').description('Show the complete deterministic policy trace for a command without running it').action(async command => {
  requireProjectScope();
  const trace = explainCommandPolicy(command.join(' '), await loadManifest());
  console.log(JSON.stringify(trace, null, 2));
  if (!trace.allowed) process.exitCode = 6;
});
security.command('scan <path>').description('Scan one text file for high-confidence credential patterns').action(async path => {
  const findings = await scanFileSecrets(path);
  if (findings.length === 0) { console.log(`PASS  no high-confidence secrets found in ${path}`); return; }
  for (const finding of findings) console.log(`SECRET  ${finding.kind}  ${finding.match}`);
  process.exitCode = 5;
});

const hooks = program.command('hooks').description('Manage project runtime Hook integration');
hooks.command('inject').description('Reconcile project Hooks into enabled runtime Hook files').action(async () => {
  requireProjectScope();
  for (const file of await injectHooks(await loadManifest())) console.log(`Managed ${file}`);
  console.log('Note: Codex may require explicit Hook trust in its own UI in addition to WiseDev manifest trust.');
});
hooks.command('remove').description('Remove only WiseDev-managed project runtime Hooks').action(async () => {
  requireProjectScope();
  for (const file of await removeHooks(await loadManifest())) console.log(`Cleaned ${file}`);
});
hooks.command('list').description('List declarative project Hooks').action(async () => {
  requireProjectScope();
  for (const line of listHooks(await loadManifest())) console.log(line);
});
program.command('hook-run <id>').description('Internal trusted project Hook dispatcher').action(async id => {
  requireProjectScope();
  const status = await runHook(await loadManifest(), id);
  if (status !== 0) process.exitCode = status;
});

const session = program.command('session').description('Record privacy-scrubbed execution evidence and friction in the selected scope');
session.command('start <task...>').description('Start a local auditable session').action(async task => {
  const root = scopeRoot(selectedScope());
  const state = await startSession(task.join(' '), root);
  console.log(`SESSION ${state.id}`);
});
session.command('record').description('Record a redacted session event').requiredOption('--type <type>', 'note|intervention|tool_failure|tool_denied|retry').requiredOption('--message <message>').action(async opts => {
  const root = scopeRoot(selectedScope());
  const event = await recordSessionEvent(opts.type as SessionEventType, opts.message, root);
  console.log(`${event.type.toUpperCase()} ${event.at}`);
});
session.command('end').description('End session, score friction and create a learning candidate when warranted').option('--threshold <score>', 'candidate threshold', '5').action(async opts => {
  const { root, manifest } = await selectedContext();
  const { summary, candidate } = await endSession(root, Number(opts.threshold));
  console.log(`FRICTION ${summary.frictionScore} events=${summary.eventCount}`);
  if (candidate) console.log(`LEARNING_CANDIDATE ${candidate.id}`);
  await emitTelemetry('session.end', { frictionScore: summary.frictionScore, eventCount: summary.eventCount, highFriction: Boolean(candidate) }, manifest, root);
});

const learning = program.command('learning').description('Manage reviewed learnings in the selected scope');
learning.command('candidates').description('List friction-generated learning candidates').action(async () => {
  const root = scopeRoot(selectedScope());
  for (const item of await listLearningCandidates(root)) console.log(`${item.id}\tfriction=${item.frictionScore}\t${item.task}`);
});
learning.command('promote <candidate>').description('Promote a candidate into a tracked learning').requiredOption('--title <title>').requiredOption('--summary <summary>').option('--tags <tags>', 'comma-separated tags', '').action(async (candidate, opts) => {
  const root = scopeRoot(selectedScope());
  console.log(`CREATED ${await promoteLearning(candidate, opts.title, opts.summary, csv(opts.tags), root)}`);
});
learning.command('add').description('Add a reviewed learning directly').requiredOption('--title <title>').requiredOption('--summary <summary>').option('--tags <tags>', 'comma-separated tags', '').action(async opts => {
  const root = scopeRoot(selectedScope());
  console.log(`CREATED ${await addLearning(opts.title, opts.summary, csv(opts.tags), root)}`);
});

program.command('recall <query...>').description('Search selected-scope learnings; project inheritance also searches user learnings').option('--limit <n>', 'maximum results', '5').action(async (query, opts) => {
  const scope = selectedScope();
  const limit = Math.max(1, Number(opts.limit));
  const text = query.join(' ');
  if (scope === 'user') {
    for (const item of await recallLearnings(text, userScopeRoot(), limit)) console.log(`${item.score}\tuser:${item.file}\tmatched=${item.matched.join(',')}\t${item.learning.title}\n  ${item.learning.summary}`);
    return;
  }
  const projectManifest = await loadManifest();
  const projectResults = (await recallLearnings(text, process.cwd(), limit)).map(item => ({ ...item, scope: 'project' as const }));
  const userResults = projectManifest.inheritUserScope ? (await recallLearnings(text, userScopeRoot(), limit)).map(item => ({ ...item, scope: 'user' as const })) : [];
  const results = [...projectResults, ...userResults]
    .sort((a, b) => b.score - a.score || b.learning.createdAt.localeCompare(a.learning.createdAt))
    .slice(0, limit);
  for (const item of results) console.log(`${item.score}\t${item.scope}:${item.file}\tmatched=${item.matched.join(',')}\t${item.learning.title}\n  ${item.learning.summary}`);
});

const evolve = program.command('evolve').description('Evaluate, approve, apply and roll back project Harness evolution candidates');
evolve.command('propose <target>').requiredOption('--content-file <path>').requiredOption('--reason <reason>').option('--source-learning <id>').action(async (target, opts) => {
  requireProjectScope();
  const content = await readFile(opts.contentFile, 'utf8');
  const candidate = await proposeEvolution(target, content, opts.reason, opts.sourceLearning);
  console.log(`CANDIDATE ${candidate.id} target=${candidate.target}`);
});
evolve.command('diff <id>').action(async id => {
  requireProjectScope();
  const candidate = await readEvolutionCandidate(id);
  let current = '';
  try { current = await readFile(candidate.target, 'utf8'); } catch {}
  const diff = evolutionDiff(candidate, current);
  console.log(`baselineLines=${diff.baselineLines} candidateLines=${diff.candidateLines} changedLines=${diff.changedLineCount} baseMatchesCurrent=${diff.baseMatchesCurrent}`);
});
evolve.command('evaluate <id>').requiredOption('--command <command>').action(async (id, opts) => {
  requireProjectScope();
  const result = await evaluateEvolution(id, opts.command);
  console.log(`${result.passed ? 'PASS' : 'FAIL'} exit=${result.exitCode}`);
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  if (!result.passed) process.exitCode = 4;
});
evolve.command('approve <id>').action(async id => { requireProjectScope(); const candidate = await approveEvolution(id); console.log(`APPROVED ${candidate.id}`); });
evolve.command('apply <id>').action(async id => { requireProjectScope(); const candidate = await applyEvolution(id); console.log(`APPLIED ${candidate.id} -> ${candidate.target}`); });
evolve.command('rollback <id>').action(async id => { requireProjectScope(); const candidate = await rollbackEvolution(id); console.log(`ROLLED_BACK ${candidate.id} -> ${candidate.target}`); });

program.command('doctor').description('Diagnose and reconcile project runtime adapter blocks').option('--fix', 'rewrite managed runtime blocks').action(async opts => {
  requireProjectScope();
  const effective = (await loadEffectiveManifest()).manifest;
  const before = await verifyHarness(process.cwd(), effective, true);
  print(before);
  if (opts.fix && hasFailures(before)) {
    for (const file of await applyAdapters(effective)) console.log(`Reconciled ${file}`);
    process.exitCode = hasFailures(await verifyHarness(process.cwd(), effective, true)) ? 1 : 0;
  }
});

program.parseAsync(process.argv).catch(error => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
