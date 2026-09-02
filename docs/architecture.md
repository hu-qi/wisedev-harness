# Architecture

## Boundary

WiseDev Harness is the infrastructure layer of WiseDev:

```text
wisedev-suite   -> reusable engineering capabilities
wisedev-team    -> multi-role orchestration and review gates
wisedev-harness -> runtime, installation, verification, distribution, evaluation and evolution
```

## Local runtime

```text
.agents/manifest.yaml
        |
        v
  manifest validator
        |
        v
 resource collector
        |
        v
 adapter plan
   |        |        |          |
 Claude   Codex    Cursor    OpenCode
   |        |        |          |
   v        v        v          v
.claude/* .codex/* .cursor/* .opencode/* + opencode.json instruction
        \      |       |       /
               v
       .agents/state.json
               |
               v
             verify
```

### Manifest

The manifest is declarative. It names enabled agent adapters and local resource roots. Paths must remain inside the project root.

### State

`.agents/state.json` is local generated state and is ignored by Git. It records hashes of resources last written by the Harness. This lets sync distinguish an unchanged managed file from a human-modified target.

### Synchronization safety

Before a write, sync classifies the target as missing, unchanged, safely-managed, or conflicting. Conflicting content fails closed unless `--force` or `policies.conflict: overwrite` is explicitly configured.

Codex rules are special: WiseDev owns only a marked block inside `AGENTS.md`, so user-maintained content outside that block remains untouched.

Cursor rules are adapter-rendered `.mdc` files rather than copied Markdown.

OpenCode rules require explicit activation. WiseDev owns only its single instructions glob in `opencode.json`; other keys and existing instructions are preserved. Configurations that cannot be safely parsed/reconciled abort the synchronization plan before filesystem mutation.

### Verification

Verification recomputes expected resources from the manifest and sources, then compares manifest hash, local state, target file hashes, agent-specific activation, and the managed Codex rules block. It does not repair anything.

## Future control plane

The commercial architecture extends the local runtime without replacing it:

```text
Observe -> Evaluate -> Candidate -> Review -> Promote -> Distribute -> Verify -> Rollback
```

Remote distribution, policy/RBAC, audit logs, signed artifacts, telemetry, and learning/evolution remain separate modules so the local deterministic runtime stays usable offline.
