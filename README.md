# WiseDev Harness

WiseDev Harness is the vendor-neutral runtime, distribution, verification, policy, knowledge, and controlled-evolution layer for WiseDev agents.

It makes agent behavior reproducible across projects, team members, and coding-agent runtimes without coupling WiseDev to one vendor.

## Product boundaries

- **wisedev-suite** — reusable capabilities and Skills.
- **wisedev-team** — multi-role orchestration and reviewer-gated workflows.
- **wisedev-harness** — installation, resource resolution, runtime adaptation, verification, policy enforcement, distribution, knowledge, and governed Harness evolution.

## Current milestone: v0.8 scope and team distribution

The current implementation includes:

- project and user scopes with backward-compatible project defaults;
- explicit safe user-resource inheritance (`inheritUserScope`);
- local role/tag profiles for per-member Skill selection;
- deterministic project-over-user precedence for same-name Skills/Sources;
- named shared Sources so repository URL/ref is declared once;
- exact commit/content lock semantics for direct and shared remote Skills;
- offline verified Skill bundle export/import for air-gapped environments;
- layered project + user Learning Recall;
- runtime capability matrix for Claude, Codex, and Cursor;
- merge-safe runtime instruction blocks and declarative cross-runtime Hooks;
- exact-manifest execution trust, allow/deny policy, secret scanning, and symlink boundary protection;
- privacy-redacted Session/friction/Learning loop;
- governed Harness evolution: `propose → evaluate → approve → apply → rollback`;
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

## Project scope

Project scope is the default and remains compatible with manifests written before v0.8:

```bash
cd /path/to/project
wisedev-harness init
wisedev-harness pull
wisedev-harness verify
```

Project state lives under `<project>/.agents/`. Claude/Codex/Cursor runtime adapters are written only for project scope.

## User scope

User scope stores cross-project resources under `~/.wisedev-harness`:

```bash
wisedev-harness --scope user init
wisedev-harness --scope user profile set --roles frontend --tags web,vue
wisedev-harness --scope user pull
wisedev-harness --scope user verify
```

A project does **not** inherit user resources merely because user scope exists. Opt in explicitly:

```yaml
version: 1
scope: project
inheritUserScope: true
project:
  name: my-project
runtimes: [claude, codex, cursor]
```

When inheritance is enabled, user Skills, Sources, Rules, and user Learnings for Recall may be consumed. User Hooks, execution policy, trust state, and command authorization never inherit into a project.

Inspect the effective resolution:

```bash
wisedev-harness scope status
wisedev-harness scope resolve
```

## Role/tag profiles

Profiles are local preferences in `<scope>/.agents/profile.yaml` and are Git-ignored by default:

```bash
wisedev-harness --scope user profile set --roles frontend --tags vue,review
wisedev-harness profile set --tags project-a
wisedev-harness profile show
```

A Skill with no constraints is selected for everyone. When `roles` and/or `tags` are declared, each declared dimension must match the local profile.

```yaml
skills:
  - name: frontend-review
    source: shared
    sourceName: engineering
    path: skills/frontend-review
    roles: [frontend]
    tags: [review]
```

## Shared Sources

Declare a team/source repository once:

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

  - name: release-review
    source: shared
    sourceName: engineering
    path: skills/release-review
```

`source: shared` is only an alias. The lockfile still stores the effective URL/ref, resolved commit, installed target, and content SHA-256.

## Reproducible remote Skill lifecycle

```bash
wisedev-harness pull       # consume existing lock pins; resolve only missing pins
wisedev-harness diff       # inspect upstream movement without changing local content
wisedev-harness update     # explicitly move configured refs and lock pins
wisedev-harness snapshots
wisedev-harness rollback
```

`pull` never silently follows a moving branch after a matching pin exists.

## Offline / air-gapped transfer

On a connected, verified machine:

```bash
wisedev-harness cache export team-bundle.wdh.gz
```

On the offline machine:

```bash
wisedev-harness cache import team-bundle.wdh.gz
wisedev-harness verify
```

Bundles contain exact lock-pinned Skill bytes. Export rejects drifted content and symlinks. Import binds targets to `.agents/skills/<name>`, validates paths, verifies staged content before replacement, and rejects modified payloads.

## Runtime capabilities

```bash
wisedev-harness capabilities
```

The current adapters cover Claude, Codex, and Cursor instruction files and Hook event translation while preserving unmanaged runtime configuration.

## Execution trust and security

Repository-declared commands do not automatically gain execution rights:

```bash
wisedev-harness trust
wisedev-harness trust-status
wisedev-harness security policy npm test
wisedev-harness hooks inject
```

Trust binds to the exact SHA-256 fingerprint of the current **project** manifest and becomes invalid after any manifest byte change. Execution-bearing resources remain project-owned even when user inheritance is enabled.

Example:

```yaml
hooks:
  - id: verify-on-stop
    description: Run project verification when an agent session stops
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
  secretScan: true
```

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

Examples:

```bash
wisedev-harness session start "fix checkout regression"
wisedev-harness session record --type tool_failure --message "test failed"
wisedev-harness session end
wisedev-harness learning candidates
wisedev-harness recall checkout regression
wisedev-harness evolve --help
```

With project user inheritance enabled, project Recall searches both project and user Learning stores and ranks results together.

## Team governance

See [TEAM_PROTOCOL.md](TEAM_PROTOCOL.md) for resource ownership, precedence, contribution/review workflow, offline transfer, and trust boundaries.

See [SECURITY.md](SECURITY.md) for security reporting and the threat boundary. See [Architecture](docs/architecture.md) and [Roadmap](ROADMAP.md) for implementation direction.

## Release integrity

Release CI requires tag/package-version parity, deterministic `npm ci`, tests/build/package verification, high-severity dependency auditing, and then emits:

- the exact npm `.tgz` artifact;
- `<artifact>.sha256`;
- `sbom.cdx.json` (CycloneDX);
- `release.json` with version, commit/ref, runtime versions, artifact name, and checksum.

The exact verified tarball is attached to GitHub Releases and is provenance-ready for npm publication.

## License

MIT.
