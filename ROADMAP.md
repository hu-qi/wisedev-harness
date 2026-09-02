# WiseDev Harness Roadmap

## v0.1 — Core runtime foundation ✅

- [x] Vendor-neutral manifest model
- [x] Safe managed-block writer
- [x] Claude / Codex / Cursor adapters
- [x] `init`, `check`, `verify`, `doctor --fix`
- [x] Required local Skill/rule checks
- [x] Unit tests and Node 20/22 CI

## v0.2 — Reproducible distribution ✅

- [x] Git Skill sources with explicit refs and resolved commit pins
- [x] Content cache and lockfile
- [x] Installed-content SHA-256 verification
- [x] `pull`, `update`, `diff`, snapshots, `rollback`
- [x] End-to-end temporary Git lifecycle tests

## v0.3 — Trusted policy hooks ✅

- [x] Vendor-neutral Hook IR
- [x] Claude / Codex / Cursor hook reconciliation
- [x] Exact-manifest trust fingerprint
- [x] Preserve unmanaged runtime hooks
- [x] Central trusted hook dispatcher

## v0.4 — Knowledge loop ✅

- [x] Privacy-redacted local session evidence
- [x] Friction event model and deterministic scoring
- [x] Reviewable learning candidates
- [x] Explicit learning promotion
- [x] Explainable lexical recall

## v0.5 — Controlled evolution ✅

- [x] Evolution proposal model with baseline hash
- [x] Trusted evaluator contract
- [x] Mandatory passing evaluation before approval
- [x] Explicit approve/apply lifecycle
- [x] Stale-baseline rejection
- [x] Deterministic rollback, including newly-created targets

## v0.6 — Security hardening ✅

- [x] Shared command allow/deny policy for Hooks and Evolution evaluators
- [x] Optional shell-metacharacter deny mode
- [x] High-confidence secret scanner
- [x] Secret gate before Evolution approval
- [x] Lexical + realpath/symlink repository-boundary protection
- [x] Local security audit log
- [x] `security policy` and `security scan` inspection commands
- [x] Security regression tests

## v0.7 — Packaging and supply chain ✅

- [x] Deterministic `package-lock.json`
- [x] `npm ci`-based CI with lockfile cache
- [x] `npm pack` package-content smoke verification
- [x] High-severity `npm audit` gate
- [x] GitHub dependency-review gate
- [x] `SECURITY.md`
- [x] Immutable tag/package-version check
- [x] CycloneDX SBOM generation
- [x] SHA-256 release checksum and machine-readable release metadata
- [x] GitHub release artifact workflow
- [x] npm provenance-ready publication of the exact verified tarball

## v0.8 — Scope and team distribution ✅

- [x] Explicit `project` and `user` scope model
- [x] Layered resource resolution with deterministic project-over-user precedence
- [x] Local role/tag based Skill selection
- [x] Named shared Harness Sources with exact lock semantics
- [x] Offline/air-gapped verified Skill bundle export/import
- [x] Team contribution/review protocol
- [x] Runtime adapter capability matrix
- [x] Layered project + user Learning Recall
- [x] Execution-bearing user Hooks/policies isolated from project inheritance
- [x] Scope/shared-source/offline-bundle regression tests

## v0.9 — Enterprise operations ✅

- [x] Opt-in structured local telemetry with privacy controls and default-off semantics
- [x] Exportable privacy-bounded audit bundles
- [x] Monotonic enterprise policy packs
- [x] Deterministic policy-conflict explain output sharing the execution decision path
- [x] Team/session health summaries from friction, security and learning signals
- [x] Pluggable in-process Recall backend contract with lexical and local JSON-index backends
- [x] Vendor-neutral MCP declaration and trusted Claude/Codex/Cursor runtime translation
- [x] MCP unmanaged-config preservation and same-name conflict fail-closed behavior
- [x] MCP/env/header audit redaction and enterprise regression tests

## v1.0 — Production/commercial readiness

- [ ] Stable manifest and adapter APIs
- [ ] Semantic versioning and manifest migration framework
- [ ] Cross-platform support: macOS/Linux/Windows
- [ ] Signed/provenance-backed releases
- [ ] Security threat model and security review
- [ ] Documentation site and migration guides
- [ ] Performance, reliability and security test suites
- [ ] Backward-compatibility guarantees
- [ ] Production support/deprecation policy

## Non-goals

WiseDev Harness does not replace `wisedev-suite` capabilities or `wisedev-team` orchestration. It supplies the runtime, distribution, verification, policy, knowledge, and controlled-evolution infrastructure beneath them.
