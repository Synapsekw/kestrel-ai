---
type: adr
date: 2026-10-03
status: accepted
tags: [decision, gotcha]
related: []
---

# Gotcha: an Alembic batch rebuild of a parent table cascades its children away

## Context

SQLite cannot alter a CHECK or a foreign key, so Alembic's batch mode rebuilds the table: it
creates `_alembic_tmp_<t>`, copies the rows, runs `DROP TABLE <t>` and renames the copy.

`open_project_db` sets `PRAGMA foreign_keys=ON` on every connection, including the one Alembic
migrates with. With foreign keys on, SQLite's `DROP TABLE` first runs an implicit `DELETE FROM`,
which fires every `ON DELETE CASCADE` and `SET NULL` child. Rebuilding `finding` that way deletes
every comment, attachment and cloud view, unlinks every cloud measurement, and raises no error.

Found while planning migration 0016 (asset findings D1), by running the batch rebuild on a scratch
0015 project: the comment count went from 1 to 0.

## Decision

- A revision that rebuilds a table other rows reference does it inside a guard that:
  1. commits any open transaction (the pragma is a no-op inside one);
  2. runs `PRAGMA foreign_keys=OFF`;
  3. reads the pragma back, and refuses to continue if it is still on;
  4. rebuilds;
  5. commits;
  6. switches foreign keys back on.

  Template: `_foreign_keys_off` in `backend/app/db/migrations/versions/0016_asset_findings.py`.
- Its test seeds the children and upgrades through `open_project_db`, never only through
  `command.upgrade`, which runs with foreign keys off and hides the loss. It also upgrades from two
  revisions back, which exercises the open-transaction path.
- A revision that only adds a column uses plain `op.add_column` (`ALTER TABLE ADD COLUMN`), never
  batch mode.
- The revision is listed in `app.migration.backup.REBUILD_GUARDS`, so the project is copied before
  it runs.

## Rationale

The loss is silent: the upgrade succeeds and the parent rows are intact; only the children are
gone. The migration tests before 0016 built old databases with plain Alembic (foreign keys off), so
a test in their style would not have caught it.

## Consequences

- Positive: 0016 keeps every child row, and the guard is reusable.
- Negative: the guard commits mid-upgrade. Each revision is still stamped in order, and 0016 is
  written to be met again after an interruption.
