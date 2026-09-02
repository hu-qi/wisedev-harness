import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  encoding: 'utf8',
  env: { ...process.env, npm_config_loglevel: 'error' }
});

if (result.error || result.status !== 0) {
  console.error(result.stderr || result.error?.message || 'npm pack --dry-run failed');
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  console.error('npm pack returned non-JSON output');
  console.error(result.stdout);
  process.exit(1);
}

const pack = payload?.[0];
if (!pack || !Array.isArray(pack.files)) {
  console.error('npm pack JSON did not include a files array');
  process.exit(1);
}

const files = new Set(pack.files.map(item => item.path));
const required = ['dist/index.js', 'README.md', 'LICENSE', 'package.json'];
const forbiddenPrefixes = ['src/', 'test/', '.github/', '.agents/'];
const failures = [];

for (const path of required) if (!files.has(path)) failures.push(`missing package file: ${path}`);
for (const path of files) {
  const prefix = forbiddenPrefixes.find(item => path.startsWith(item));
  if (prefix) failures.push(`unexpected development file in package: ${path}`);
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (packageJson.bin?.['wisedev-harness'] !== 'dist/index.js') failures.push('package bin must point to dist/index.js');

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

console.log(`PASS package ${pack.name}@${pack.version} contains ${pack.files.length} files (${pack.unpackedSize} bytes unpacked)`);
