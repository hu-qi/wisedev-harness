# WiseDev Harness

WiseDev Harness is the runtime and lifecycle control plane for AI-assisted software engineering. It makes project Harness configuration deterministic, conflict-safe, and verifiable across coding agents.

The project is deliberately separate from:

- `wisedev-suite` — reusable engineering capabilities and skills.
- `wisedev-team` — multi-role delivery orchestration and reviewer gates.
- `wisedev-harness` — runtime, installation, verification, distribution, evaluation, and evolution.

## Current milestone: v0.1 local runtime

The first implementation supports Claude Code and Codex with four intentionally distinct commands:

```bash
wisedev-harness init
wisedev-harness check
wisedev-harness sync
wisedev-harness verify
```

- `init` creates only the missing Harness baseline (or replaces the manifest only with explicit `--force`).
- `check` diagnoses the environment and manifest without repairing anything.
- `sync` writes only targets declared and managed by the Harness; conflicting local edits fail closed by default.
- `verify` is read-only and reports manifest/state/target drift.

## Install from source

```bash
git clone https://github.com/hu-qi/wisedev-harness.git
cd wisedev-harness
npm install
npm test
npm link
```

Then, in a business project:

```bash
cd /path/to/project
wisedev-harness init --agent claude,codex
```

This creates:

```text
.agents/
├── manifest.yaml
├── .gitignore       # ignores local state.json
├── skills/
└── rules/
```

Add resources, for example:

```text
.agents/skills/my-skill/SKILL.md
.agents/rules/project.md
```

Preview and synchronize:

```bash
wisedev-harness check
wisedev-harness sync --dry-run
wisedev-harness sync
wisedev-harness verify
```

## Manifest

```yaml
version: 1
project:
  name: my-project
agents:
  - claude
  - codex
resources:
  skills:
    - .agents/skills
  rules:
    - .agents/rules
policies:
  conflict: fail
```

### Managed targets

| Resource | Claude Code | Codex |
|---|---|---|
| Skills | `.claude/skills/**` | `.codex/skills/**` |
| Rules | `.claude/rules/wisedev/**` | Marked WiseDev block inside `AGENTS.md` |

Codex integration never replaces the whole `AGENTS.md`; only the block between `wisedev-harness:rules:start/end` is owned by the Harness.

## Safety properties

- Declared source paths cannot escape the project root.
- Symlink resource roots and managed targets are rejected.
- Unmanaged/local modifications are not overwritten by default.
- State is hashed so drift can be distinguished from normal updates.
- `check` and `verify` never repair the project.
- `sync --dry-run` exposes intended writes/deletes first.

## Development

```bash
npm install
npm run typecheck
npm test
npm pack --dry-run
```

See [Architecture](docs/architecture.md), [Roadmap](docs/roadmap.md), [Security](SECURITY.md), and [Contributing](CONTRIBUTING.md).

## License

MIT
