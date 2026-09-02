# WiseDev Harness

WiseDev Harness is the runtime and lifecycle control plane for AI-assisted software engineering.

It bootstraps project-local agent environments, validates harness manifests, installs shared rules and skills through agent adapters, verifies drift, and provides the foundation for eval-driven harness evolution.

## Product boundary

- `wisedev-suite`: reusable engineering capabilities and skills.
- `wisedev-team`: multi-role delivery orchestration and review gates.
- `wisedev-harness`: reliable runtime, installation, verification, distribution, evaluation, and evolution.

## Status

Active development. The first milestone is a production-shaped CLI with deterministic project bootstrap, manifest validation, agent adapters, drift detection, tests, and CI.

## Planned CLI

```bash
wisedev-harness init
wisedev-harness check
wisedev-harness verify
wisedev-harness sync
```

## Design principles

1. Project-local and deterministic by default.
2. Never rewrite unrelated project files.
3. Generated state is traceable to a manifest and can be verified.
4. Agent-specific behavior lives behind adapters.
5. Verification is read-only unless the user explicitly requests repair.
6. Evolution proposals must be evaluated before promotion.

## License

MIT
