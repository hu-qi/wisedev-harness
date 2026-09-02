# WiseDev Harness

WiseDev Harness is the vendor-neutral runtime, distribution, verification, policy, knowledge, and controlled-evolution layer for WiseDev agents.

It is designed to make agent behavior reproducible across projects and coding-agent runtimes without coupling WiseDev to one vendor.

## Product boundaries

- **wisedev-suite** — reusable capabilities and skills.
- **wisedev-team** — multi-role orchestration and reviewer-gated workflows.
- **wisedev-harness** — installation, manifest resolution, runtime adaptation, verification, policy enforcement, distribution, knowledge, and governed harness evolution.

## Current milestone: v0.6 security hardening

Implemented:

- Strict `.agents/manifest.yaml` schema.
- Merge-safe managed blocks that preserve user-owned content.
- Claude, Codex, and Cursor runtime adapters.
- `init`, `check`, `verify`, and `doctor --fix`.
- Reproducible HTTPS git Skill sources with explicit refs, lockfile pinning, content hashes, cache, update/diff, snapshots, and rollback.
- Declarative cross-runtime hooks with exact-manifest trust before command execution.
- Execution allow/deny policy shared by Hooks and Evolution evaluators.
- High-confidence secret scanning for private keys, common cloud/API tokens, bearer tokens, and credential assignments.
- Realpath/symlink project-boundary protection for evolution writes.
- Local security audit evidence under `.agents/audit/`, ignored by Git by default.
- Privacy-redacted sessions, deterministic friction scoring, reviewed learning promotion, and explainable recall.
- Governed Harness evolution: `propose → evaluate → approve → apply → rollback`, with stale-baseline protection.
- Unit and end-to-end lifecycle/security tests on Node 20 and 22.

## Development usage

```bash
npm install
npm run build
node dist/index.js init
node dist/index.js check
node dist/index.js verify
node dist/index.js pull
node dist/index.js diff
node dist/index.js update
node dist/index.js trust
node dist/index.js hooks inject
node dist/index.js security policy npm test
node dist/index.js security scan .env.example
node dist/index.js session start "fix checkout regression"
node dist/index.js recall checkout regression
node dist/index.js evolve --help
```

After package publication the intended interface is:

```bash
npm install -g wisedev-harness
wisedev-harness init
wisedev-harness pull
wisedev-harness verify
```

## Manifest example

```yaml
version: 1
project:
  name: my-project
runtimes: [claude, codex, cursor]

skills:
  - name: wisedev-requirement-spec
    source: git
    url: https://github.com/example/wisedev-suite.git
    ref: main
    path: skills/wisedev-requirement-spec
    required: true

hooks:
  - id: verify-on-stop
    description: Run the project verification suite when an agent session stops
    event: Stop
    command: npm test
    timeout: 120

policies:
  requireHookTrust: true
  execution:
    allow: [npm, git status]
    deny: [npm publish, rm]
    denyShellMetacharacters: false
    protectSymlinkEscapes: true
    scanEvolutionSecrets: true
```

Repository-declared commands do not automatically gain execution rights. Review the manifest and run `wisedev-harness trust`; trust is bound to the exact SHA-256 fingerprint of the current manifest and becomes invalid after any manifest byte change.

## Reproducible Skill lifecycle

`pull` resolves a git ref only when the Skill has no matching lock entry. Once locked, later pulls install the exact resolved commit. Use `update` when you explicitly want to move the lock to the current configured ref. Installed content is hashed and verified against `.agents/harness.lock.json`.

## Controlled evolution

Harness changes never silently self-promote:

```text
session evidence
  → friction
  → learning candidate
  → reviewed learning
  → evolution proposal
  → trusted evaluation
  → explicit approval
  → apply
  → rollback
```

Evolution writes are restricted to the project root, protected against symlink escape, secret-scanned before approval, and rejected if the target changed after proposal.

## Safety model

- Never overwrite unmanaged user content.
- Never silently repair malformed managed markers.
- Never run repository-wide auto-fix during bootstrap.
- Missing required resources fail checks explicitly.
- Remote Skills are HTTPS-only in normal operation.
- Installed remote Skill content is checked against its lockfile hash.
- Repository-declared shell execution requires explicit trust.
- Denied commands fail closed and emit local audit evidence.
- Harness evolution cannot escape the project root through lexical paths or symlinks.
- High-confidence secrets block evolution approval.
- Raw session, trust, cache, audit, evaluation, and backup state are local and ignored by Git by default.
- Vendor-specific translation stays behind adapters.

See [Architecture](docs/architecture.md) and [Roadmap](ROADMAP.md).

## License

MIT.
