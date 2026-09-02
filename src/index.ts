#!/usr/bin/env node
import { Command } from 'commander';
import { applyAdapters } from './adapters.js';
import { checkHarness, hasFailures, initHarness, verifyHarness } from './core.js';
import { loadManifest } from './manifest.js';

const program = new Command();
program.name('wisedev-harness').description('WiseDev agent harness runtime and verification CLI').version('0.1.0');

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
