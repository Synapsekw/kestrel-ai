---
type: adr
date: 2026-10-01
status: accepted
tags: [decision, gotcha]
related: ["[[2026-10-01-2205-reports-wave]]"]
---

# A Playwright route handler that calls route.fetch() can fail the next test

## Context

`e2e/detect-export.spec.ts` (adapted in Reports R7) overrides `GET /report-templates` with
`page.route(..., async route => { const res = await route.fetch(); ... route.fulfill(...) })`. The
test's last assertion passed while a template refetch was still inside `route.fetch()`. When the test
ended, Playwright tore the route down and reported `route.fetch: Test ended ... while running route
callback` — against the **next** test in that worker. CI showed `drawings-import.spec.ts:140`
(an unrelated elevation import) failing twice on the R7 merge commit, and passing on the next commit
because test order shifted. It looked like a flake in Maps code.

## Decision

Any e2e test that installs a `page.route` handler doing async work (`route.fetch()`, awaited JSON)
ends with `await page.unrouteAll({ behavior: "ignoreErrors" })`. Applied to
`detect-export.spec.ts` (`4feb0f8`) and `reports-data-exports.spec.ts` (R10 pre-merge).

## Rationale

The failure is reported in the wrong test, so the usual reading ("that spec is flaky") points at the
wrong code. Unrouting with `ignoreErrors` is Playwright's own recommendation in the error text and
costs nothing.

## Consequences

- Positive: route handlers can no longer leak a failure into a neighbouring spec.
- Negative: one more line to remember in specs that route.
- Open follow-ups: when an e2e failure's error text names a route callback or an endpoint the
  failing test never calls, look at the previous test in the same worker first.

## Related

- [[2026-10-01-2205-reports-wave]]
