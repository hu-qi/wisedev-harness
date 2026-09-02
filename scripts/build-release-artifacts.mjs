import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const outDir = resolve('.release');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

function run(args, options = {}) {
  const result = spawnSync(npm, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    console.error(result.stderr || result.error?.message || `npm ${args.join(' ')} failed`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const packed = JSON.parse(run(['pack', '--json', '--ignore-scripts', '--pack-destination', outDir]));
const filename = packed?.[0]?.filename;
if (!filename) {
  console.error('npm pack did not return an artifact filename');
  process.exit(1);
}

const tarballPath = resolve(outDir, filename);
const tarball = readFileSync(tarballPath);
const sha256 = createHash('sha256').update(tarball).digest('hex');
writeFileSync(resolve(outDir, `${filename}.sha256`), `${sha256}  ${filename}\n`);

const sbom = run(['sbom', '--sbom-format', 'cyclonedx', '--omit=dev']);
JSON.parse(sbom);
writeFileSync(resolve(outDir, 'sbom.cdx.json'), sbom.endsWith('\n') ? sbom : `${sbom}\n`);

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const metadata = {
  schemaVersion: 1,
  name: packageJson.name,
  version: packageJson.version,
  tarball: filename,
  sha256,
  commit: process.env.GITHUB_SHA ?? null,
  ref: process.env.GITHUB_REF_NAME ?? null,
  node: process.version,
  npm: run(['--version']).trim()
};
writeFileSync(resolve(outDir, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`);

console.log(`PASS release artifact ${filename} sha256=${sha256}`);
