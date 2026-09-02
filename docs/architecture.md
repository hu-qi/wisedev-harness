# Architecture

WiseDev Harness is intentionally vendor-neutral and split into five layers.

1. **Manifest** — `.agents/manifest.yaml` is the project source of truth.
2. **Resolution** — required skills, rules and policies are validated before runtime use.
3. **Adapters** — vendor-specific agent instruction files are generated through merge-safe managed blocks.
4. **Verification** — `check` validates dependencies; `verify` also validates generated runtime integration; `doctor --fix` reconciles drift.
5. **Evolution (planned)** — telemetry and friction signals produce reviewable improvement candidates rather than silently mutating production harnesses.

## Safety invariants

- Never overwrite unmanaged user content.
- Never run repository-wide auto-fix as an implicit bootstrap action.
- Missing required dependencies are failures, not warnings hidden from the caller.
- Generated content must be identifiable and reconcilable.
- Runtime adapters may translate policy but may not change policy semantics.
- Evolution changes must be evidence-backed, evaluated, reviewable and rollbackable.

## Repository boundaries

- `wisedev-suite`: reusable skills/capabilities.
- `wisedev-team`: role orchestration and reviewer gates.
- `wisedev-harness`: runtime, distribution, policy, verification and evolution infrastructure.

## Compatibility strategy

The Harness core owns a stable manifest model. Runtime-specific behavior is isolated behind adapters. New coding agents should therefore be integrated by adding adapters rather than leaking vendor-specific configuration into the manifest.
