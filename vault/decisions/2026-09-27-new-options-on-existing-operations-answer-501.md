---
type: adr
date: 2026-09-27
status: accepted
tags: [decision, contract, maps]
related:
  [
    "[[2026-09-26-foundation-contract-lands-before-its-backend]]",
    "[[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]]",
  ]
---

# New options on existing operations answer 501 until their unit builds them

## Context

The map-workspace contract unit (M-C0) lands every M operation before any M backend unit builds it,
as Foundation did. Foundation's mechanism covers new _operations_ (501 stubs, `EXPECTED_STUBS`) and
new _response fields_ (`BACKEND_PENDING`). M also adds _request options_ to operations that already
work: `polygon_site`, `material` and the `toe_lowest` base on volume create/patch, `region` on
`createRuns`, `category` on site areas. Schemathesis sends them in its positive cases. Ignored, a
region run would silently run over the whole map, and a `material`-only PATCH would be refused with
`validation_error` as an empty patch, which the contract test treats as a bug.

## Decision

- A request that uses a declared-but-unbuilt option answers 501 `not_implemented` with details
  `{option, unit}`, from one guard per option in `backend/app/workspace/pending.py`, before any lookup.
- `OPTION_STUBS` in `tests/test_contract.py` names the operations that may answer that 501; any other
  501 still fails the test.
- New response fields on existing schemas are required and passed through from their new column in
  the same change (never left to `BACKEND_PENDING`), so every response conforms from the merge on.
- Read-only query options (`frame=site`) are ignored until their unit: the fields they add are
  optional and simply absent.
- A new enum column that later code filters with `!=` is NOT NULL with a server default: in SQL
  `NULL != 'region'` is not true, so a nullable `map_run.scope` would drop every old run from the
  timeline.

## Consequences

- The owning unit (M-B5; M-B2 for the surface patch's date and role) deletes each guard, its call
  site, its `OPTION_STUBS` entry and its test as it builds the option; the last one deletes the module and the `or op_id in OPTION_STUBS` clause.
- I-C0 and C-C0 can reuse `OPTION_STUBS` for their own options instead of inventing a third mechanism.
