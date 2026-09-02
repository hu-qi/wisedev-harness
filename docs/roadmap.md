# Roadmap

## M0 — Deterministic local runtime (v0.1)

- [x] Manifest and project bootstrap.
- [x] Read-only check/verify commands.
- [x] Safe sync with managed state and drift detection.
- [x] Claude Code and Codex skill adapters.
- [x] Claude rules and non-destructive Codex `AGENTS.md` rules.
- [x] Integration tests and CI.

## M1 — Multi-agent distribution (v0.2)

- [x] Cursor adapter with `.mdc` rule rendering.
- [ ] OpenCode adapter and instruction activation.
- [x] Machine-readable `plan` output shared by dry-run/sync behavior.
- [x] Linux/macOS/Windows integration matrix.
- [ ] Remote Git sources with pinned refs and lockfile.
- [ ] Managed hooks and MCP configuration with secret references only.
- [ ] Resource namespaces, tags and project/user scopes.
- [ ] Lock dependency graph and publish release artifacts.

## M2 — Team-ready governance (v0.3)

- Signed/pinned Harness bundles.
- Policy engine for allowed sources, adapters and write surfaces.
- PR-first Harness update workflow.
- Audit events and reproducible provenance.
- Team distribution service protocol separated from local runtime.
- Rollback to last-known-good Harness revision.

## M3 — Eval and learning loop (v0.4)

- Session/event ingestion with privacy filtering.
- Friction signals: user correction, denied actions, repeated failures and reviewer blocks.
- Structured learnings with evidence and source session references.
- Recall API for project/team knowledge.
- Harness evaluation suites and regression gates.

## M4 — Harness evolution (v0.5)

- Generate explicit Harness-change candidates from validated learnings.
- Offline/CI evaluation against benchmark tasks.
- Risk scoring and human approval policy.
- Automatic PR creation for candidates that clear evaluation thresholds.
- Promotion, canary rollout, rollback and change-effect measurement.

## Commercial readiness gate (1.0)

A 1.0 release requires stable manifest compatibility, secure update provenance, adapter conformance, cross-platform support, migration tooling, RBAC/audit support for team deployments, published threat model, SLOs for any hosted control-plane component, and documented enterprise deployment/backup/rollback procedures.
