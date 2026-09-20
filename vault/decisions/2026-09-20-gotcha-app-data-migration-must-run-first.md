---
type: adr
date: 2026-09-20
status: accepted
tags: [decision, gotcha]
related: []
---

# Gotcha: the app-data migration must run first in setup()

## Context

Tauri derives the app-data folder from the bundle identifier
(`app.path().app_data_dir()` resolves to `%APPDATA%\<identifier>`). Renaming the identifier
points the app at an empty new folder unless the old one is migrated across.

## Decision

The `appdata::migrate` call in `lib.rs`'s `setup()` must stay the first thing that touches
`app_data_dir`. Registering any plugin that touches it earlier (store, log, fs) — or launching
any build before the migration runs — creates the new folder first, which makes `migrate()` see
it already present and return `BothPresent` forever (never migrating anything). Writing the log
before the rename step would cause the same problem, which is why the log append sits inside the
match arms after the rename decision, not before it.

## Rationale

`migrate()`'s decision logic depends on whether the new folder already exists; anything that
creates that folder ahead of the migration call poisons the check permanently, since the
migration only ever runs once (idempotent by design).

## Consequences

- Positive: the operator's pre-rename recent-projects list and settings move automatically on
  first launch of the renamed app.
- Negative: `setup()` has an ordering constraint that isn't enforced by the compiler — a future
  edit that reorders plugin registration or logging could silently break migration.
- Open follow-ups: none.

## Related

-
