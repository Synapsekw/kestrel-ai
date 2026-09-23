---
type: adr
date: 2026-09-23
status: accepted
tags: [decision, gotcha]
related: ["[[2026-09-23-1655-geotiff-maps]]", "[[2026-09-22-1930-project-agent]]"]
---

# Two task branches each took migration 0004, and nothing noticed until the merge

## Context

The GeoTIFF maps branch and the project agent branch were built in parallel, each in its own
worktree, each cut from `main` at `0003`. Both added tables, so both wrote
`backend/app/db/migrations/versions/0004_*.py` with `revision = "0004"` and
`down_revision = "0003"`.

Every gate passed on both branches, repeatedly — 788 tests on one, 854 on the other — because each
worktree only ever saw its own `0004`. Alembic had one linear chain in both. The collision existed
only in the union, which no test ran until `git merge`, and even then git merged cleanly: the two
files have different names, so there is no textual conflict to report. The result would have been
two heads from `0003`, and `open_project_db`'s `command.upgrade(cfg, "head")` fails on an ambiguous
head — meaning **no project would open**, on the one path the app cannot survive failing.

The same shared-state class of problem bit twice more in the same block, more cheaply:

- Two implementers working in **one** worktree share the git index. One ran `git add` on its files;
  the other committed in that window and swept them in. Recovered with `reset --soft` +
  `restore --staged`, but the rule stands: never run two implementers in one worktree, even when
  their file sets are provably disjoint.
- The main checkout's `node_modules` predated the merge, so nine test files failed to import and
  `tsc` reported an implicit `any` in a file nobody had touched. `pnpm install` was the whole fix.
  A merge that changes `package.json` is not complete until the checkout it lands in is installed.

## Decision

Treat migration revision ids as a **shared resource across every live branch**, not a per-branch
counter:

1. Before writing a migration, check what every other worktree and branch has claimed:
   `git log --all --oneline -- backend/app/db/migrations/versions/` and
   `ls` each worktree's `versions/` directory. Take the next free id.
2. At merge, re-derive the chain rather than trusting either side: renumber the later branch's
   migration and set its `down_revision` to the one already on `main`.
3. Verify a single head before committing the merge, from the merged tree:
   ```
   python -c "from alembic.config import Config; from alembic.script import ScriptDirectory; \
   cfg=Config('app/db/migrations/alembic.ini'); cfg.set_main_option('script_location','app/db/migrations'); \
   sd=ScriptDirectory.from_config(cfg); print(sd.get_heads(), [r.revision for r in sd.walk_revisions()][::-1])"
   ```
   One head, and the chain in order, or the merge is not done.

This block did exactly that: maps `0004` became `0005` with `down_revision = "0004"`, heads
`['0005']`, chain `0001..0005`, then the full gate re-run on the merged tree.

## Rationale

The cost of the check is seconds; the cost of missing it is an app that will not open a project
after an ordinary merge, discovered by an operator rather than by CI. Nothing in the current gate
can catch it: per-branch suites are green by construction, and `git merge` is silent because the
filenames differ. A reviewer reading either diff sees a correct migration.

Renumbering the later branch (rather than making one a branch label or merging heads) keeps the
chain linear, which is what `upgrade head` and the app's startup path assume.

## Consequences

### Positive

- A merge-time check that is cheap and mechanical, and that fails loudly in the one place the
  failure is still free to fix.
- The same habit generalises: shared, non-textual resources — revision ids, event-type enums, job
  types, `Record<Job["type"], …>` maps, route tables — are exactly what parallel branches collide
  on without git noticing. This block hit three of those four.

### Negative

- Renumbering rewrites a committed file at merge time, so the branch's own history names a
  revision that no longer exists. Acceptable: the merge commit explains it, and nothing had run
  the old id against a real database.

### Open follow-ups

- A CI check could assert one alembic head on `main` after every merge; it would have caught this
  automatically. Not written this block.
- The parallel-session hazards are now spread across this ADR, the worktree-removal ADR and the
  session notes. If a third instance appears, they want consolidating into one "working in
  parallel" page.

## Related

- [[2026-09-23-1655-geotiff-maps]] — the block where this surfaced.
- [[2026-09-22-1930-project-agent]] — the other branch in the collision.
