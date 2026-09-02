import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const input = process.argv[2] || process.env.GITHUB_REF_NAME;
if (!input) {
  console.error('Release tag is required as argv[2] or GITHUB_REF_NAME.');
  process.exit(1);
}

const expected = `v${packageJson.version}`;
if (input !== expected) {
  console.error(`Release tag/version mismatch: tag=${input} package=${packageJson.version}; expected ${expected}`);
  process.exit(1);
}

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input)) {
  console.error(`Unsupported release tag format: ${input}`);
  process.exit(1);
}

console.log(`PASS release tag ${input} matches package version ${packageJson.version}`);
