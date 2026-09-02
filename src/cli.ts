#!/usr/bin/env node
import path from 'node:path';
import { checkProject, initProject, syncProject, verifyProject } from './project.js';
import { SUPPORTED_AGENTS, type AgentId, type Diagnostic, type Operation } from './types.js';

const VERSION = '0.1.0';

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function parseAgents(raw: string | undefined): AgentId[] {
  if (!raw) return [];
  const agents = [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))];
  const unsupported = agents.filter((agent) => !(SUPPORTED_AGENTS as readonly string[]).includes(agent));
  if (unsupported.length > 0) throw new Error(`Unsupported agent(s): ${unsupported.join(', ')}`);
  return agents as AgentId[];
}

function printDiagnostics(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const prefix = diagnostic.level === 'error' ? 'ERROR' : diagnostic.level === 'warning' ? 'WARN' : 'INFO';
    console.log(`[${prefix}] ${diagnostic.code}: ${diagnostic.message}${diagnostic.path ? ` (${diagnostic.path})` : ''}`);
  }
}

function printOperations(operations: Operation[]): void {
  const actionable = operations.filter((operation) => operation.type !== 'noop');
  if (actionable.length === 0) return;
  console.log('');
  console.log('Operations:');
  for (const operation of actionable) console.log(`  ${operation.type.toUpperCase().padEnd(6)} ${operation.path} — ${operation.reason}`);
}

function printHelp(): void {
  console.log(`WiseDev Harness ${VERSION}\n\nUsage:\n  wisedev-harness <command> [options]\n\nCommands:\n  init      Create a project-local Harness manifest and resource roots\n  check     Diagnose environment, manifest, and declared resource roots\n  sync      Synchronize declared resources into enabled Agent adapters\n  verify    Verify manifest, state, and managed target drift\n  version   Print version\n\nGlobal options:\n  --cwd <path>        Operate on another project directory\n  --json              Emit JSON for check/verify\n\ninit options:\n  --agent <ids>       Comma-separated agents: claude,codex\n  --force             Explicitly replace an existing manifest\n\nsync options:\n  --dry-run           Show changes without writing\n  --force             Overwrite conflicting managed targets\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const cwdRaw = optionValue(args, '--cwd');
  const root = path.resolve(cwdRaw ?? process.cwd());
  const json = hasFlag(args, '--json');

  try {
    switch (command) {
      case 'init': {
        const agents = parseAgents(optionValue(args, '--agent'));
        const result = await initProject(root, { force: hasFlag(args, '--force'), ...(agents.length > 0 ? { agents } : {}) });
        printDiagnostics(result.diagnostics);
        printOperations(result.operations);
        if (result.diagnostics.some((item) => item.level === 'error')) process.exitCode = 1;
        break;
      }
      case 'check': {
        const diagnostics = await checkProject(root);
        if (json) console.log(JSON.stringify({ ok: !diagnostics.some((item) => item.level === 'error'), diagnostics }, null, 2));
        else printDiagnostics(diagnostics);
        if (diagnostics.some((item) => item.level === 'error')) process.exitCode = 1;
        break;
      }
      case 'sync': {
        const result = await syncProject(root, { force: hasFlag(args, '--force'), dryRun: hasFlag(args, '--dry-run') });
        printDiagnostics(result.diagnostics);
        printOperations(result.operations);
        if (result.diagnostics.some((item) => item.level === 'error')) process.exitCode = 1;
        break;
      }
      case 'verify': {
        const result = await verifyProject(root);
        if (json) console.log(JSON.stringify(result, null, 2));
        else printDiagnostics(result.diagnostics);
        if (!result.ok) process.exitCode = 1;
        break;
      }
      case 'version':
      case '--version':
      case '-v':
        console.log(VERSION);
        break;
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        printHelp();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exitCode = 2;
    }
  } catch (error) {
    console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

void main();
