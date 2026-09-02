# Security Policy

WiseDev Harness executes and distributes configuration that can affect AI coding agents, local shell commands, and project files. Treat Harness manifests and remote Skill sources as code.

## Supported versions

Until v1.0, security fixes are applied to the latest minor release line only. After v1.0, the supported-version window will be documented here and in the release policy.

## Reporting a vulnerability

Do not publish a working exploit, credential, private repository URL, or other sensitive evidence in a public issue.

Use GitHub's private vulnerability reporting / Security Advisory flow for this repository when available. If private reporting is unavailable, open a minimal public issue that states only that a security report is needed and contains no exploit details or secrets.

A useful report includes:

- affected WiseDev Harness version or commit;
- operating system and Node.js version;
- affected runtime adapter (Claude, Codex, Cursor, or core);
- impact and required attacker capabilities;
- minimal reproduction steps with synthetic/non-sensitive data;
- whether the issue crosses the project boundary, bypasses trust/policy, exposes secrets, or compromises distributed Skills.

## Security boundaries

The project intentionally enforces these invariants:

- Repository-declared Hook and Evolution evaluation commands do not execute until the exact current manifest has been explicitly trusted.
- Command deny policy takes precedence over allow policy.
- Evolution targets must remain inside the project root after both lexical and realpath/symlink resolution.
- High-confidence secrets block Evolution approval by default.
- Remote Skills use HTTPS in normal operation and are pinned to resolved commits in the Harness lockfile.
- Installed remote Skill content is hash-verified against the lockfile.
- Managed runtime configuration preserves unmanaged user content and fails closed on malformed managed markers.
- Raw session evidence, trust records, security audit logs, caches, evaluation workspaces, and rollback backups remain local and are ignored by Git by default.

## Out of scope / not a security guarantee

- Trusting a manifest is an explicit authorization decision; it does not make arbitrary third-party commands safe.
- Pattern-based secret scanning reduces accidental disclosure but cannot prove that content contains no secret.
- WiseDev Harness does not sandbox commands. Execution policy and manifest trust are authorization controls, not an operating-system sandbox.
- Runtime vendors may impose additional trust or hook behavior outside WiseDev Harness control.

## Dependency and release security

Release CI is expected to use the committed lockfile, `npm ci`, package-content verification, vulnerability auditing, SBOM generation, immutable version/tag checks, checksums, and npm provenance-capable publication.
