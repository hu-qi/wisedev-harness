# WiseDev Harness

WiseDev Harness is the runtime and lifecycle control plane for AI-assisted software engineering. It makes project Harness configuration deterministic, conflict-safe, and verifiable across coding agents.

The project is deliberately separate from:

- `wisedev-suite` — reusable engineering capabilities and skills.
- `wisedev-team` — multi-role delivery orchestration and reviewer gates.
- `wisedev-harness` — runtime, installation, verification, distribution, evaluation, and evolution.

## Current milestone: v0.2 alpha

The current implementation supports Claude Code, Codex, Cursor, and OpenCode:

```bash
wisedev-harness init
wisedev-harness check
wisedev-harness plan
wisedev-harness sync
wisedev-harness verify
```

- `init` creates only the missing Harness baseline (or replaces the manifest only with explicit `--force`).
- `check` diagnoses the environment and manifest without repairing anything.
- `plan` computes the exact synchronization operations without writing targets or state.
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
wisedev-harness init --agent claude,codex,cursor,opencode
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
wisedev-harness plan --json
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
  - cursor
  - opencode
resources:
  skills:
    - .agents/skills
  rules:
    - .agents/rules
policies:
  conflict: fail
```

### Managed targets

| Resource | Claude Code | Codex | Cursor | OpenCode |
|---|---|---|---|---|
| Skills | `.claude/skills/**` | `.codex/skills/**` | `.cursor/skills/**` | `.opencode/skills/**` |
| Rules | `.claude/rules/wisedev/**` | Marked WiseDev block inside `AGENTS.md` | `.cursor/rules/wisedev/*.mdc` | `.opencode/rules/wisedev/**/*.md` + one `opencode.json` instructions entry |

Codex integration never replaces the whole `AGENTS.md`; only the block between `wisedev-harness:rules:start/end` is owned by the Harness.

Cursor rules are rendered as `.mdc` files with YAML frontmatter and `alwaysApply: true`, because Cursor does not load plain `.md` files from its project rules directory.

OpenCode rules are copied as Markdown and activated by the single managed instructions glob `.opencode/rules/wisedev/**/*.md` in the project `opencode.json`. Existing keys and user instruction entries are preserved. Invalid JSON or a non-array `instructions` value causes synchronization to fail before any writes are applied.

## Safety properties

- Declared source paths cannot escape the project root.
- Symlink resource roots and managed targets are rejected.
- Unmanaged/local modifications are not overwritten by default.
- State is hashed so drift can be distinguished from normal updates.
- OpenCode config changes are key-level and fail closed on formats the Harness cannot safely reconcile.
- `check`, `plan`, and `verify` never repair the project.
- `sync --dry-run` remains available as a compatibility preview path.

## Development

```bash
npm install
npm run typecheck
npm test
npm pack --dry-run
```

CI covers Linux, macOS, and Windows on Node.js 20 and 22.

See [Architecture](docs/architecture.md), [Roadmap](docs/roadmap.md), [Security](SECURITY.md), and [Contributing](CONTRIBUTING.md).

## License

MIT
