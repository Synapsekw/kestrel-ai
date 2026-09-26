---
type: adr
date: 2026-09-26
status: accepted
tags: [decision, contract, foundation]
related: ["[[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]]", "[[2026-09-20-gotcha-openapi-default-makes-a-field-required-in-typescript]]"]
---

# The foundation contract lands before its backend

## Context

The inspection foundation (spec `2026-09-26-foundation-design`, unit C0) lands its whole API in
one merge so that five units can then build in parallel without touching `openapi.yaml`. But the
gate runs against that file three ways: `backend/tests/test_contract.py` requires every contract
operation to be routed, no other route to exist, and every response to validate; `pnpm -C frontend
build` type-checks the generated client; and the e2e suite runs the UI against Prism serving the
contract. A contract that is ahead of both the backend and the UI fails all three.

## Decision

- Every new operation is routed to a 501 stub from `backend/app/foundation_stubs.py`, one list per
  building unit; `EXPECTED_STUBS` is derived from those lists, so a unit only deletes its tuple.
- `BACKEND_PENDING` in `test_contract.py` names the existing operations whose responses the backend
  cannot yet fill (new required fields); for them the test only asserts "no 5xx". The unit that
  lands last for an entry deletes it.
- Operations the foundation replaces stay in the contract with `deprecated: true` and
  `x-retire-with: F-<unit>` until that unit deletes their last caller; `RETIRING` lets a backend unit
  delete the route first.
- The project `kind` leaves the contract at once; the frontend reads it only through
  `src/api/legacyKind.ts` (absent means `train`), which unit SH deletes with the kind UI.

## Rationale

Main stays green after every merge, and each later unit's change is a deletion in a file C0 names,
never a new mechanism. Leaving the frontend build red "until SH" would have failed the gate of
every unit that merges before SH, for a reason none of them owns.

## Consequences

- Positive: batch-2 units code against final names and types from day one, and the Prism mock
  already serves every new endpoint with examples.
- Negative: three transitional allowances live in `test_contract.py` until the last backend unit
  lands, and a real backend after BK sends no `kind`, so the pre-SH screens treat every project as
  a training project until SH merges.
- Operations that also return the widened `Project`, `ClassDef` or `LibraryModel` schemas
  (`openProject`, `getLibraryModel`, `updateLibraryModel`, and the deprecated
  `listDatasets`/`getDataset`/`createDataset`) pass today only because the contract test never gets
  a populated 200 from them; a unit whose fixtures make one of them answer 200 before BK, BC and BM
  have landed adds it to `BACKEND_PENDING`.
- Follow-ups: the hand-off table in `docs/superpowers/plans/2026-09-26-foundation-c0-contract.md`.

## Related

- [[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]] — the same "reserve up front" idea for migration ids
- [[2026-09-20-gotcha-openapi-default-makes-a-field-required-in-typescript]]
