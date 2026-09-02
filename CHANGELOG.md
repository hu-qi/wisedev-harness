# Changelog

All notable changes to WiseDev Harness will be documented here.

## 0.2.0-alpha.1 - Unreleased

### Added

- Read-only `plan` command with machine-readable JSON output.
- Cursor skill adapter using `.cursor/skills/**`.
- Cursor rules adapter rendering `.mdc` files with required frontmatter.
- Linux, macOS, and Windows CI matrix on Node.js 20 and 22.

## 0.1.0 - 2026-09-02

### Added

- Project-local `.agents/manifest.yaml` initialization.
- Manifest schema validation and source-root safety checks.
- Claude Code and Codex adapters for skills.
- Claude project rules synchronization.
- Non-destructive managed rule block injection into Codex `AGENTS.md`.
- Conflict-safe synchronization with local state tracking.
- Read-only drift verification.
- JSON diagnostics for automation.
- Node.js 20/22 CI and integration tests.
