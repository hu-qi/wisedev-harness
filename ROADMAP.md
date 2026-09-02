# WiseDev Harness Roadmap

## v0.1 — Core runtime foundation

- [x] Vendor-neutral manifest model
- [x] Safe managed-block writer
- [x] Claude / Codex / Cursor adapters
- [x] `init`, `check`, `verify`, `doctor --fix`
- [x] Required local skill/rule checks
- [x] Unit tests and Node 20/22 CI
- [ ] Package-lock and published npm package
- [ ] End-to-end fixture tests

## v0.2 — Distribution and lifecycle

- Git skill sources with pinning by tag/commit
- Content-addressed cache and lockfile
- `pull`, `update`, `diff`, `rollback`
- Project/user scopes
- Adapter capability matrix
- Offline and air-gapped operation
- Signed release metadata and checksum verification

## v0.3 — Policy and hooks

- Declarative hook model
- PreToolUse / PostToolUse / SessionStart / SessionEnd abstraction
- Secret scanning guardrail
- Repository-scope write boundary policy
- Command allow/deny policy
- MCP server declaration and runtime translation
- Policy conflict detection and explain output

## v0.4 — Team and knowledge

- Shared Harness repository protocol
- Git review/promotion workflow
- Role/tag based resource distribution
- Learnings store with provenance
- Recall API and pluggable retrieval backend
- Session summaries with privacy redaction

## v0.5 — Evaluation and evolution

- Friction event model
- Eval suites for skills, rules and adapters
- Candidate harness change generation
- Baseline/candidate comparison
- Automatic PR creation, never silent promotion
- Promotion gates and deterministic rollback
- Regression budgets and safety guardrails

## v1.0 — Production/commercial readiness

- Stable manifest and adapter APIs
- Semantic versioning and migration framework
- Cross-platform support: macOS/Linux/Windows
- Supply-chain security and SBOM
- Signed releases
- Structured telemetry with opt-in controls
- Enterprise policy packs
- Audit logs
- Documentation site and migration guides
- Performance, reliability and security test suites
- Backward-compatibility guarantees

## Non-goals

WiseDev Harness does not replace `wisedev-suite` capabilities or `wisedev-team` orchestration. It supplies the runtime, distribution, verification, policy and evolution infrastructure beneath them.
