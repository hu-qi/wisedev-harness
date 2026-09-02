# Contributing

## Development

```bash
npm install
npm run typecheck
npm test
```

## Change rules

- Keep `check` and `verify` read-only.
- New write behavior must be deterministic, scoped to explicitly managed targets, and covered by a conflict test.
- Agent-specific filesystem behavior belongs in adapters, not command handlers.
- Manifest schema changes require migration/versioning notes.
- New evolution behavior must produce a candidate and evaluation evidence before promotion.

## Pull requests

Every PR should state the behavior change, managed files affected, backwards-compatibility impact, and tests added.
