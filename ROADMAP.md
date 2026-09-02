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

## v0.7 — Packaging and supply chain ✅ implementation / CI pending merge

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

## v0.8 — Scope and team distribution

- [ ] Explicit `project` and `user` scope model
- [ ] Layered resource resolution with deterministic precedence
- [ ] Role/tag based Skill selection
- [ ] Additional shared Harness sources
- [ ] Offline/air-gapped cache export/import
- [ ] Team contribution/review protocol
- [ ] Adapter capability matrix

## v0.9 — Enterprise operations

- [ ] Opt-in structured telemetry with privacy controls
- [ ] Exportable audit bundles
- [ ] Enterprise policy packs
- [ ] Policy conflict explain output
- [ ] Team/session health summaries
- [ ] Pluggable recall backend
- [ ] MCP declaration and runtime translation

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
