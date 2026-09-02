# WiseDev Harness

WiseDev Harness is the vendor-neutral runtime, distribution, verification, policy, knowledge, enterprise-operations, and controlled-evolution layer for WiseDev agents.

It makes agent behavior reproducible across projects, team members, and coding-agent runtimes without coupling WiseDev to one vendor.

## Product boundaries

- **wisedev-suite** — reusable capabilities and Skills.
- **wisedev-team** — multi-role orchestration and reviewer-gated workflows.
- **wisedev-harness** — installation, resource resolution, runtime adaptation, verification, policy enforcement, distribution, knowledge, enterprise operations, and governed Harness evolution.

## Current milestone: v0.9 enterprise operations

The implementation now includes:

- project/user scopes, role/tag selection, shared Sources, deterministic Skill lock/update/rollback, and offline verified bundles;
- Claude, Codex, and Cursor instruction/Hook adapters that preserve unmanaged configuration;
- exact-manifest trust, command policy, secret scanning, repository-boundary protection, and controlled evolution;
- privacy-redacted Session → friction → Learning → Recall flow;
- governed Harness evolution: `propose → evaluate → approve → apply → rollback`;
- opt-in local telemetry, health summaries, and privacy-bounded audit exports;
- monotonic enterprise policy packs and deterministic policy-conflict explanation;
- vendor-neutral MCP declarations translated into Claude `.mcp.json`, Codex `.codex/config.toml`, and Cursor `.cursor/mcp.json`;
- pluggable in-process Recall backend contract with built-in `lexical` and local `json-index` backends;
- deterministic npm packaging/release pipeline with lockfile, audit, Dependency Review, SBOM, checksum, release metadata, and provenance-ready publication.

## Install / develop

```bash
npm ci
npm run build
npm test
node dist/index.js --help
```

After npm publication:

```bash
npm install -g wisedev-harness
```

## Project and user scopes

Project scope is the default:

```bash
cd /path/to/project
wisedev-harness init
wisedev-harness pull
wisedev-harness verify
```

User scope stores cross-project resources under `~/.wisedev-harness`:

```bash
wisedev-harness --scope user init
wisedev-harness --scope user profile set --roles frontend --tags web,vue
wisedev-harness --scope user pull
```

A project inherits user resources only when explicitly configured:

```yaml
version: 1
scope: project
inheritUserScope: true
project:
  name: my-project
runtimes: [claude, codex, cursor]
```

User Skills, Sources, Rules, and Learnings may be inherited. User Hooks, execution policy, trust state, MCP authorization, and command authorization never inherit into a project.

```bash
wisedev-harness scope status
wisedev-harness scope resolve
```

## Role/tag profiles and shared Sources

Profiles are local and Git-ignored:

```bash
wisedev-harness --scope user profile set --roles frontend --tags vue,review
wisedev-harness profile show
```

Shared repositories are declared once:

```yaml
sources:
  - name: engineering
    url: https://github.com/example/engineering-harness.git
    ref: main

skills:
  - name: frontend-review
    source: shared
    sourceName: engineering
    path: skills/frontend-review
    roles: [frontend]
    tags: [review]
```

The lockfile still records the effective URL/ref, resolved commit, canonical target, and content SHA-256.

## Reproducible and offline Skill lifecycle

```bash
wisedev-harness pull
wisedev-harness diff
wisedev-harness update
wisedev-harness snapshots
wisedev-harness rollback

wisedev-harness cache export team-bundle.wdh.gz
wisedev-harness cache import team-bundle.wdh.gz
wisedev-harness verify
```

Offline import uses canonical `.agents/skills/<name>` targets and verifies staged content before replacement. Forged targets, symlinks, or modified payloads fail closed.

## Execution policy and enterprise packs

Repository-declared executable behavior requires explicit project trust:

```bash
wisedev-harness trust
wisedev-harness trust-status
wisedev-harness security policy npm test
wisedev-harness security explain npm publish
wisedev-harness security packs
```

Built-in policy packs are monotonic: they may add denials or stricter shell rules but never widen an allow list.

```yaml
policies:
  requireHookTrust: true
  policyPacks: [enterprise-baseline]
  execution:
    allow: [npm, git status]
    deny: [rm]
    denyShellMetacharacters: false
```

`security explain` reports allow matches, deny matches, policy-pack provenance, shell-metacharacter gates, and deny-over-allow conflicts using the same decision path as actual Hook/Evolution execution.

## MCP

Declare MCP once in the Harness manifest:

```yaml
mcpServers:
  - name: local-tools
    transport: stdio
    command: npx
    args: [-y, my-mcp-server]
    env:
      MODE: production

  - name: remote-tools
    transport: http
    url: https://mcp.example.com/mcp
    bearerTokenEnvVar: MCP_TOKEN
    headers:
      X-Team: WiseDev
```

Then review the manifest and explicitly trust it before injection:

```bash
wisedev-harness mcp list
wisedev-harness trust
wisedev-harness mcp inject
```

`mcp inject` preserves unmanaged runtime configuration and refuses same-name unmanaged collisions. `mcp remove` removes only WiseDev-managed MCP entries and does not require trust, so emergency cleanup remains possible.

## Enterprise observability

Telemetry is **disabled by default**, remains local, and excludes the project name unless explicitly requested:

```bash
wisedev-harness telemetry status
wisedev-harness telemetry enable
wisedev-harness health
wisedev-harness health --json
```

Audit export is explicit:

```bash
wisedev-harness audit export evidence.wdh-audit.gz
```

The audit bundle includes the manifest fingerprint/effective configuration, lock state, redacted Session summaries, security decisions, reviewed Learnings, and health summary. It excludes raw Session logs, trust state, caches, Evolution workspaces/backups, and local credentials. MCP environment/header values are redacted.

## Recall backends

Default Recall remains deterministic lexical ranking over tracked Learnings:

```yaml
recall:
  backend: lexical
```

A local prebuilt JSON Learning index can be selected without granting process/network execution:

```yaml
recall:
  backend: json-index
  indexPath: .agents/recall-index.json
```

The package also exposes an in-process Recall backend registry for trusted integrators. Manifest files cannot declare arbitrary executable Recall backends.

## Knowledge and controlled evolution

```text
session evidence
  → friction
  → learning candidate
  → reviewed learning
  → recall
  → evolution proposal
  → trusted evaluation
  → explicit approval
  → apply
  → rollback
```

```bash
wisedev-harness session start "fix checkout regression"
wisedev-harness session record --type tool_failure --message "test failed"
wisedev-harness session end
wisedev-harness learning candidates
wisedev-harness recall checkout regression
wisedev-harness evolve --help
```

## Runtime and team governance

```bash
wisedev-harness capabilities
```

See [TEAM_PROTOCOL.md](TEAM_PROTOCOL.md) for ownership, precedence, contribution/review workflow, offline transfer, and trust boundaries. See [SECURITY.md](SECURITY.md) for the security model and reporting policy. See [Architecture](docs/architecture.md) and [Roadmap](ROADMAP.md) for implementation direction.

## Release integrity

Release CI requires tag/package-version parity, deterministic `npm ci`, tests/build/package verification, high-severity dependency auditing, and emits:

- the exact npm `.tgz` artifact;
- `<artifact>.sha256`;
- `sbom.cdx.json` (CycloneDX);
- `release.json` with version, commit/ref, runtime versions, artifact name, and checksum.

The exact verified tarball is attached to GitHub Releases and is provenance-ready for npm publication.

## License

MIT.
