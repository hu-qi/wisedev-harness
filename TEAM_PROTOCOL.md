# WiseDev Harness Team Protocol

This document defines how a team shares Harness resources without turning local AI configuration into an unreviewed remote-execution channel.

## 1. Resource ownership

WiseDev Harness separates two scopes:

- **user scope** — cross-project, reusable resources installed under `~/.wisedev-harness`;
- **project scope** — repository-specific resources rooted in the current project.

Project scope is authoritative for project behavior. A project opts into safe user-resource inheritance with:

```yaml
scope: project
inheritUserScope: true
```

Inheritance is explicit. It is never enabled merely because user scope exists.

## 2. What can be inherited

When `inheritUserScope: true`, the effective project Harness may read:

- Skills;
- named shared Sources;
- Rules;
- user-scope Learnings during Recall.

The following remain project-owned and are **not** inherited from user scope:

- Hooks;
- execution policy;
- manifest trust;
- Evolution command authorization;
- runtime Hook installation state.

This boundary prevents a shared/user Harness from silently granting project-local shell execution.

## 3. Deterministic precedence

Resolution order is deterministic:

1. load user resources when inheritance is enabled;
2. overlay project resources;
3. for same-name Sources or Skills, the project definition wins;
4. apply the local role/tag profile;
5. resolve remote/shared Skills to exact commits and content hashes in the project lockfile.

Use:

```bash
wisedev-harness scope resolve
```

to inspect every selected/skipped resource, origin, and selection reason.

## 4. Local role/tag profiles

Roles and tags are local selection preferences, not team identity records. They live in:

```text
<scope>/.agents/profile.yaml
```

and are ignored by Git by default.

Example:

```bash
wisedev-harness --scope user profile set --roles frontend --tags web,vue
wisedev-harness profile set --tags project-a
```

A Skill with no role/tag constraints is available to everyone. If a Skill declares roles or tags, each declared dimension must match at least one selected value.

## 5. Named shared Sources

A repository URL/ref should be declared once and referenced by Skills:

```yaml
sources:
  - name: engineering
    url: https://github.com/example/engineering-harness.git
    ref: main

skills:
  - name: frontend-review
    source: shared
    sourceName: engineering
    path: skills/frontend-review
    roles: [frontend]
    tags: [review]
```

`source: shared` is only an aliasing mechanism. The lockfile records the actual URL, ref, resolved commit, target, and content SHA-256, so reproducibility is not weakened.

## 6. Contribution workflow

Treat shared Harness resources as production code:

1. create a branch;
2. modify Skills/Rules/Sources;
3. run Harness checks and relevant evaluations;
4. review security impact, especially new remote Sources or execution-bearing changes;
5. open a pull request;
6. require normal code review/CI before merge;
7. consumers run `diff` to inspect available changes and `update` to intentionally move lock pins.

Do not make `pull` silently track a moving branch. `pull` consumes existing pins; `update` is the explicit upgrade operation.

## 7. Offline / air-gapped transfer

After a connected machine has installed and verified exact lock-pinned Skills:

```bash
wisedev-harness cache export team-bundle.wdh.gz
```

Transfer the bundle through the organization's approved channel, then on the offline machine:

```bash
wisedev-harness cache import team-bundle.wdh.gz
wisedev-harness verify
```

The import path is constrained to `.agents/skills/<name>` and staged content is hash-verified before replacing an existing Skill. A forged target path or modified payload is rejected.

## 8. Trust and execution

Repository content and shell execution are separate trust domains.

A manifest containing Hooks or Evolution evaluators still requires explicit project trust:

```bash
wisedev-harness trust
```

Trust binds to the exact project manifest SHA-256. Any manifest byte change invalidates it.

User-scope resources never inherit command execution rights into a project.

## 9. Review checklist

For a team Harness change, reviewers should check:

- Is the resource genuinely cross-project or should it stay project-local?
- Does a new Source use an expected HTTPS repository and ref?
- Are role/tag constraints necessary and understandable?
- Does the change introduce or widen shell execution?
- Does `scope resolve` show the expected precedence?
- Does `diff` show only intentional lock movement?
- Can the change be rolled back deterministically?
- Does it preserve private/local profile, trust, session, audit, and cache state?
