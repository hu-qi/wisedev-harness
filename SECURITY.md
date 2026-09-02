# Security Policy

WiseDev Harness executes and distributes configuration that can affect AI coding agents, local shell commands, MCP connectivity, and project files. Treat Harness manifests and remote Skill sources as code.

## Supported versions

Until v1.0, security fixes are applied to the latest minor release line only. After v1.0, the supported-version window is defined by the production support policy.

## Reporting a vulnerability

Do not publish a working exploit, credential, private repository URL, or other sensitive evidence in a public issue.

Use GitHub's private vulnerability reporting / Security Advisory flow for this repository when available. If private reporting is unavailable, open a minimal public issue that states only that a security report is needed and contains no exploit details or secrets.

A useful report includes:

- affected WiseDev Harness version or commit;
- operating system and Node.js version;
- affected runtime adapter (Claude, Codex, Cursor, or core);
- impact and required attacker capabilities;
- minimal reproduction steps with synthetic/non-sensitive data;
- whether the issue crosses the project boundary, bypasses trust/policy, exposes secrets, compromises MCP configuration, or compromises distributed Skills.

## Security boundaries

The project intentionally enforces these invariants:

- Repository-declared Hook and Evolution evaluation commands do not execute until the exact current manifest has been explicitly trusted.
- MCP injection also requires exact-current-manifest trust; MCP removal remains available without trust for emergency cleanup.
- MCP reconciliation preserves unmanaged runtime configuration and refuses same-name unmanaged collisions instead of overwriting them.
- Command deny policy takes precedence over allow policy.
- Built-in enterprise policy packs are monotonic: they can add denials or stricter shell rules but cannot widen project allow rules.
- `security explain` uses the same deterministic decision path as actual execution policy enforcement.
- Evolution targets must remain inside the project root after lexical and realpath/symlink resolution.
- High-confidence secrets block Evolution approval by default.
- Remote Skills use HTTPS in normal operation and are pinned to resolved commits in the Harness lockfile.
- Installed remote Skill content is hash-verified against the lockfile.
- Offline bundle import validates canonical targets and staged content before replacing installed Skills.
- Managed runtime configuration preserves unmanaged user content and fails closed on malformed managed markers.
- Telemetry is disabled by default, local-only in v0.9, and omits project identity unless explicitly enabled.
- Audit export is explicit and excludes raw Session logs, trust state, caches, Evolution workspaces/backups, and local credential state.
- MCP environment and HTTP-header values are redacted from exported audit evidence.
- Raw session evidence, trust records, security audit logs, telemetry, caches, evaluation workspaces, MCP management state, and rollback backups remain local and are ignored by Git by default.
- Manifest-selected Recall backends are limited to safe built-ins; arbitrary executable/network Recall providers are not manifest-configurable.

## Out of scope / not a security guarantee

- Trusting a manifest is an explicit authorization decision; it does not make arbitrary third-party commands or MCP servers safe.
- MCP servers may execute code or access remote systems according to their own implementation and runtime permissions. WiseDev Harness governs configuration distribution, not MCP server sandboxing.
- Pattern-based secret scanning and structured audit redaction reduce accidental disclosure but cannot prove that content contains no secret.
- WiseDev Harness does not sandbox commands. Execution policy and manifest trust are authorization controls, not an operating-system sandbox.
- Runtime vendors may impose additional trust, Hook, MCP, or configuration behavior outside WiseDev Harness control.
- Local telemetry and health metrics are operational signals, not forensic guarantees.

## Dependency and release security

Release CI uses the committed lockfile, `npm ci`, package-content verification, vulnerability auditing, Dependency Review, SBOM generation, immutable version/tag checks, checksums, and npm provenance-capable publication.
