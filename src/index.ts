#!/usr/bin/env node
import { Command } from 'commander';
import { applyAdapters } from './adapters.js';
import { checkHarness, hasFailures, initHarness, verifyHarness } from './core.js';
import { diffHarness, listSnapshots, pullHarness, rollbackHarness } from './distribution.js';
import { injectHooks, listHooks, removeHooks, runHook } from './hooks.js';
import { loadManifest } from './manifest.js';
import { isManifestTrusted, revokeTrust, trustManifest } from './trust.js';

const program = new Command();
program.name('wisedev-harness').description('WiseDev agent harness runtime and verification CLI').version('0.3.0');

function print(checks: Awaited<ReturnType<typeof checkHarness>>) {
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  ${c.detail}`);
  if (hasFailures(checks)) process.exitCode = 1;
}

program.command('init')
  .description('Initialize project harness without clobbering existing agent instructions')
  .option('--force', 'replace the manifest; managed agent blocks remain merge-safe')
  .action(async opts => {
    const result = await initHarness(process.cwd(), Boolean(opts.force));
    console.log(`Initialized ${result.manifestPath}`);
    for (const file of result.touched) console.log(`Managed ${file}`);
  });

program.command('check').description('Validate environment, manifest and required resources').action(async () => print(await checkHarness()));
program.command('verify').description('Run check plus runtime adapter integrity verification').action(async () => print(await verifyHarness()));

program.command('pull').description('Install git skills at versions pinned in the lockfile; resolve only missing pins').action(async () => {
  const lock = await pullHarness(await loadManifest(), process.cwd(), false);
  for (const [name, item] of Object.entries(lock.skills)) console.log(`SYNC  ${name}  ${item.resolved.slice(0, 12)}  ${item.target}`);
});

program.command('update').description('Resolve configured git refs again, install them, and update the lockfile').action(async () => {
  const lock = await pullHarness(await loadManifest(), process.cwd(), true);
  for (const [name, item] of Object.entries(lock.skills)) console.log(`UPDATE  ${name}  ${item.resolved.slice(0, 12)}  ${item.target}`);
});

program.command('diff').description('Compare locked git skills with current configured refs without installing changes').action(async () => {
  const entries = await diffHarness(await loadManifest());
  for (const item of entries) console.log(`${item.status.toUpperCase()}  ${item.name}${item.locked ? `  locked=${item.locked.slice(0, 12)}` : ''}${item.remote ? `  remote=${item.remote.slice(0, 12)}` : ''}`);
  if (entries.some(item => item.status !== 'current')) process.exitCode = 2;
});

program.command('snapshots').description('List saved lockfile snapshots').action(async () => {
  for (const name of await listSnapshots()) console.log(name);
});

program.command('rollback [snapshot]').description('Restore git skills from a previous lockfile snapshot').action(async snapshot => {
  const chosen = await rollbackHarness(await loadManifest(), process.cwd(), snapshot);
  console.log(`Rolled back using ${chosen}`);
});

program.command('trust').description('Trust the exact current manifest fingerprint for command hooks').action(async () => {
  const record = await trustManifest();
  console.log(`Trusted manifest ${record.manifestSha256}`);
});

program.command('untrust').description('Revoke local hook execution trust').action(async () => {
  await revokeTrust();
  console.log('Manifest hook trust revoked.');
});

program.command('trust-status').description('Show whether the exact current manifest is trusted').action(async () => {
  const trusted = await isManifestTrusted();
  console.log(trusted ? 'TRUSTED' : 'UNTRUSTED');
  if (!trusted) process.exitCode = 3;
});

const hooks = program.command('hooks').description('Manage runtime hook integration');
hooks.command('inject').description('Reconcile WiseDev hooks into enabled runtime hook files').action(async () => {
  const files = await injectHooks(await loadManifest());
  for (const file of files) console.log(`Managed ${file}`);
  console.log('Note: Codex may require explicit hook trust in its own UI in addition to WiseDev manifest trust.');
});
hooks.command('remove').description('Remove only WiseDev-managed runtime hooks').action(async () => {
  for (const file of await removeHooks(await loadManifest())) console.log(`Cleaned ${file}`);
});
hooks.command('list').description('List declarative hooks from the manifest').action(async () => {
  for (const line of listHooks(await loadManifest())) console.log(line);
});

program.command('hook-run <id>').description('Internal trusted hook dispatcher').action(async id => {
  const status = await runHook(await loadManifest(), id);
  if (status !== 0) process.exitCode = status;
});

program.command('doctor').description('Diagnose and reconcile generated runtime adapter blocks').option('--fix', 'rewrite managed runtime blocks').action(async opts => {
  const before = await verifyHarness();
  print(before);
  if (opts.fix && hasFailures(before)) {
    const manifest = await loadManifest();
    const files = await applyAdapters(manifest);
    for (const file of files) console.log(`Reconciled ${file}`);
    process.exitCode = hasFailures(await verifyHarness()) ? 1 : 0;
  }
});

program.parseAsync(process.argv).catch(error => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
