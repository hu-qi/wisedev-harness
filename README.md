# WiseDev Harness

WiseDev Harness is the vendor-neutral runtime, distribution, verification, policy, and evolution layer for WiseDev agents.

It is designed to make agent behavior reproducible across projects and coding-agent runtimes without coupling WiseDev to one vendor.

## Product boundaries

- **wisedev-suite** — reusable capabilities and skills.
- **wisedev-team** — multi-role orchestration and reviewer-gated workflows.
- **wisedev-harness** — installation, manifest resolution, runtime adaptation, verification, policy enforcement, distribution, and harness evolution.

## Current milestone: v0.2 distribution lifecycle

Implemented:

- Strict `.agents/manifest.yaml` schema.
- Merge-safe managed blocks that preserve user-owned content.
- Claude, Codex, and Cursor runtime adapters.
- `init`, `check`, `verify`, and `doctor --fix`.
- Reproducible HTTPS git skill sources with required `ref`.
- `.agents/harness.lock.json` pinned to resolved commits and content hashes.
- `pull` installs lock-pinned versions; `update` explicitly refreshes refs.
- `diff` reports upstream changes without installing them.
- Lock snapshots and `rollback`.
- Installed-skill integrity checks against the lockfile.
- Unit tests plus an end-to-end temporary-git lifecycle test.
- Node 20/22 CI.

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
node dist/index.js snapshots
node dist/index.js rollback
node dist/index.js doctor --fix
```

After package publication the intended interface is:

```bash
npm install -g wisedev-harness
wisedev-harness init
wisedev-harness pull
wisedev-harness verify
```

## Git skill example

```yaml
version: 1
project:
  name: my-project
runtimes: [claude, codex]
skills:
  - name: wisedev-requirement-spec
    source: git
    url: https://github.com/example/wisedev-suite.git
    ref: main
    path: skills/wisedev-requirement-spec
    required: true
```

`pull` resolves a git ref only when the skill has no matching lock entry. Once locked, all later pulls install the exact resolved commit. Use `update` when you explicitly want to move the lock to the current configured ref.

## Generated project contract

`wisedev-harness init` creates `.agents/manifest.yaml` as the Harness source of truth and injects only a clearly delimited managed block into supported runtime instruction files. Existing unmanaged project content is preserved.

Default runtimes are Claude and Codex. Cursor can be enabled in the manifest.

## Safety model

- Never overwrite unmanaged user content.
- Never silently repair malformed managed markers.
- Never run repository-wide auto-fix during bootstrap.
- Missing required resources fail checks explicitly.
- Remote skills are HTTPS-only in normal operation.
- Installed remote skill content is checked against its lockfile hash.
- Vendor-specific translation stays behind adapters.
- Future self-evolution must go through evidence, evaluation, review, promotion, and rollback gates.

See [Architecture](docs/architecture.md) and [Roadmap](ROADMAP.md).

## License

MIT.
