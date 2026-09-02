# Security Policy

## Supported versions

Until the first stable release, only the latest published version is supported.

## Security model

WiseDev Harness treats project content as untrusted input.

- Resource paths must stay inside the project root.
- Resource-root and managed-target symlinks are rejected.
- Existing unmanaged or locally modified managed files are not overwritten unless an explicit force/overwrite policy is used.
- `verify` is read-only.
- The Harness does not execute synchronized skill or rule content.
- Secrets must not be stored in Harness manifests or synchronized resources.

## Reporting a vulnerability

Do not disclose exploitable vulnerabilities in a public issue. Contact the repository owner through a private GitHub channel where available and include reproduction steps, affected versions, and impact.
