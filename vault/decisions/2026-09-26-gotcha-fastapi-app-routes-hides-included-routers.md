---
type: adr
date: 2026-09-26
status: accepted
tags: [decision, gotcha, backend, testing]
related: ["[[2026-09-26-foundation-contract-lands-before-its-backend]]"]
---

# Gotcha: on FastAPI 0.141 `app.routes` hides the routes of included routers

## Context

`backend/tests/test_project_kinds.py::test_every_project_route_declares_its_kinds` walks
`app.routes`, keeps the `APIRoute`s under `/api/v1/projects/{projectId}` and fails on one without a
`require_kind`. On FastAPI 0.141 an included router stays an `_IncludedRouter` object in
`app.routes` (the app's route list holds one `_IncludedRouter` and the websocket route), so the
walk finds zero `APIRoute`s and passes whatever the routers declare. Checked while planning the
foundation contract: a stub router included without any kind guard passed it.

## Decision

A test that must see every route walks `app.openapi()["paths"]` (as `test_contract.py` does), or
descends into included routers explicitly; it never trusts `app.routes` alone, and it asserts that
it found a plausible number of routes before asserting anything about them.

## Rationale

A walk that sees nothing proves nothing, and it looks green. The foundation's unit BK plans a route
walk that asserts "no `require_kind` remains" (spec §16), which would pass vacuously the same way.

## Consequences

- Positive: route-walk tests that count what they walked cannot pass empty.
- Negative: on FastAPI 0.141 `test_project_kinds.py` guards nothing; BK deletes
  it with the kind guard.

## Related

- [[2026-09-26-foundation-contract-lands-before-its-backend]]
