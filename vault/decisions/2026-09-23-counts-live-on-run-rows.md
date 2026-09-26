---
type: adr
date: 2026-09-23
status: accepted
tags: [decision, detection, counts, database]
related: ["[[2026-09-23-train-detect-split-and-model-library-design]]", "[[2026-09-23-library-jobs-reuse-the-project-jobrunner]]"]
---

# Counts live on run rows; review increments them in the same transaction

## Context

A detection project answers "how many excavators were on site in May, and how many of those has a
person checked?" for every survey, every site area and every photo batch. The raw material is
large: one orthomosaic run can hold hundreds of thousands of `MapDetection` rows, and a photo run
owns `Box` rows spread over thousands of images. Analytics, the Sources list, the Runs table, the
survey timeline and the CSV/PDF exports all need the same numbers, and the hot-path rule says no
screen scans a detection table to get them.

Review changes those numbers one detection at a time: accept, reject, change class, draw a missed
object, undo, accept above a confidence, mark an image empty, delete images.

## Decision

The numbers are stored on the run row, beside the run (plan 2, deviation 1):

- `counts` — `{class_id: n}`, every detection that is not rejected (the *total*; it kept its old
  shape, so the survey timeline reads it unchanged);
- `verified_counts` — `{class_id: n}`, the accepted or edited ones (a person-drawn detection is
  stored as accepted);
- `area_counts` (map runs only) — `{area_id: {class_id: {"total": n, "verified": n}}}`.

One set of rules in `backend/app/detect/counts.py` produces them two ways:

- **Increment.** Every review write computes the old and the new `(class_id, review_state)` of each
  detection it touches and calls `apply_transition` / `apply_area_transition`. It does this inside
  the **same** `with handle.session() as s:` block as the state change, so the detection and the
  run's numbers commit together or not at all (`app/detect/review.py` for maps,
  `app/datasets/boxes.py` for photo boxes).
- **Rebuild.** `recount_query_run` / `recount_map_run` rebuild a run from grouped `COUNT` queries
  (area membership streams `MapDetection` rows with `yield_per(5000)`). The `recount` job, the end
  of an `infer` / `map_detect` run, `area_recount` after a site-area change, and bulk image
  deletion use it.

A key whose number drops to 0 is removed, so an incremented dict and a rebuilt one are equal. The
tests hold that as the invariant: every review test compares the stored numbers with a recount
(`tests/test_detect_review.py`), and `tests/test_detect_flow.py` checks that analytics do not move
when a recount runs after a full review.

## Rationale

- Analytics becomes O(surveys + areas × classes): it reads run rows and `Source` / `GeoMap` rows
  only. `tests/test_detect_analytics.py` asserts with a `before_cursor_execute` listener that the
  area and photo-batch analytics never query `map_detection`.
- One transaction means a crash, a killed sidecar or a failed write can never leave a reviewed
  detection without its increment, or an increment without its review.
- Keeping `counts` as the total (instead of reshaping it in place, as spec §9.2 first proposed)
  needs no data rewrite in the migration: `0008_detect_workspace` only adds nullable or defaulted
  columns, so the app still starts if anything about it goes wrong.

## Consequences

- Positive: every screen and both exports read the same numbers; nothing counts twice in two
  places.
- Negative: every new code path that changes a detection's class or review state **must** go
  through the counting rules in the same session. A write that forgets does not fail; the numbers
  just drift until someone runs a recount. The recount job is the repair tool, and the
  compare-with-recount tests are the guard.
- Trap: the count columns are plain JSON. SQLAlchemy does not see in-place changes to a dict, so
  `run.counts[c] += 1` is silently **not** saved. Work on copies and assign them back (as
  `review.py` does), or call `flag_modified`.
- Trap: `_bump` clamps a count that would go below zero and logs a warning instead of raising. A
  warning "count for … went below zero" in the log means some write skipped the rules; recount the
  run and find the write.
- Area counts depend on the site areas: adding, editing or deleting an area submits one
  `area_recount` job over every map run, rather than touching counts inline.

## Related

- `backend/app/detect/counts.py`, `backend/app/detect/review.py`, `backend/app/datasets/boxes.py`,
  `backend/app/detect/site_areas.py`, `backend/app/db/migrations/versions/0008_detect_workspace.py`
- Plan `docs/superpowers/plans/2026-09-23-detection-workspace.md` (deviation 1, Budget)
- Spec `docs/superpowers/specs/2026-09-23-train-detect-split-and-model-library-design.md` §8–§9
