---
type: adr
date: 2026-09-26
status: accepted
tags: [decision, gotcha, database, catalogue, findings]
related: ["[[2026-09-26-foundation-design]]", "[[2026-09-23-counts-live-on-run-rows]]"]
---

# `Project.classes` is derived from `project_type`, and finding numbers use a high-water mark

## Context

The foundation moved class lists from a JSON column on `project` to the app-wide catalogue plus a
per-project `project_type` snapshot. About a dozen backend readers call `handle.row(s).classes`
(boxes, review, maps, analytics, exports, inference). The spec also says a finding number is
`max(number) + 1` and is never reused after a delete, which contradict each other the moment the
newest finding is deleted.

## Decision

- `Project.legacy_classes` maps the old `classes` column (read-only, MG's migration input for one
  release). `Project.classes` is a **property without a setter** that reads `project_type` through
  the row's own session (`app/catalogue/project_types.py::project_classes`). Readers are unchanged; a
  leftover writer raises `AttributeError` instead of silently writing the legacy column. A project
  below `schema_version` 2 with no type rows shows its legacy classes until MG migrates it.
- `project.finding_seq` holds the highest number ever handed out. Allocation runs an `UPDATE` first
  (taking SQLite's write lock), setting it to `max(finding_seq, max(finding.number)) + n`.
- `finding.annotation_id` references `box.id` with **no** `ON DELETE`: a bulk `DELETE FROM box` that
  skips `app/findings/annotations.py` fails loudly instead of leaving findings without geometry and
  counts wrong.
- New projects are born at `schema_version` 2 only once MG's migration steps are armed
  (`app.migration.job.armed()`); while disarmed they start at 1, and MG's steps (which keep existing
  `project_type` rows) bring them to 2.

## Consequences

- Code that needs the class list outside a session (a detached row) must read it inside one.
- New code that deletes boxes in bulk must call `annotations.on_images_deleting` (or delete the
  findings itself) first; the foreign key will tell it if it forgets.
- `Project(classes=...)` no longer works in tests; build pre-foundation fixtures with
  `legacy_classes=` or raw SQL.
