# WiseDev Harness

WiseDev Harness is the vendor-neutral runtime, distribution, verification, policy, and evolution layer for WiseDev agents.

It is designed to make agent behavior reproducible across projects and coding-agent runtimes without coupling WiseDev to one vendor.

## Product boundaries

- **wisedev-suite** — reusable capabilities and skills.
- **wisedev-team** — multi-role orchestration and reviewer-gated workflows.
- **wisedev-harness** — installation, manifest resolution, runtime adaptation, verification, policy enforcement, distribution, and harness evolution.

## Current milestone: v0.1 core

Implemented on the current development branch:

- Strict `.agents/manifest.yaml` schema.
- Merge-safe managed blocks that preserve user-owned content.
- Claude, Codex, and Cursor runtime adapters.
- `init`, `check`, `verify`, and `doctor --fix` commands.
- Required local skill/rule validation.
- Node 20/22 CI and unit tests for managed-block safety.

## Development usage

```bash
npm install
npm run build
node dist/index.js init
node dist/index.js check
node dist/index.js verify
node dist/index.js doctor --fix
```

After package publication the intended interface is:

```bash
npm install -g wisedev-harness
wisedev-harness init
wisedev-harness check
wisedev-harness verify
```

## Generated project contract

`wisedev-harness init` creates `.agents/manifest.yaml` as the Harness source of truth and injects only a clearly delimited managed block into supported runtime instruction files. Existing unmanaged project content is preserved.

Default runtimes are Claude and Codex. Cursor can be enabled in the manifest.

## Safety model

- Never overwrite unmanaged user content.
- Never silently repair malformed managed markers.
- Never run repository-wide auto-fix during bootstrap.
- Missing required resources fail checks explicitly.
- Vendor-specific translation stays behind adapters.
- Future self-evolution must go through evidence, evaluation, review, promotion, and rollback gates.

See [Architecture](docs/architecture.md) and [Roadmap](ROADMAP.md).

## License

MIT.
