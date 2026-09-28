# Gotcha: a schemathesis operation keeps its app alive for the whole session

**Date:** 2026-09-28 · **Status:** accepted

## Context
CI failed `test_contract.py::test_responses_conform` intermittently with `ReadTimeout (read timeout=10)`,
each time on a different route (`POST /map-measurements`, `POST /runs/{runId}/accept-above`). The routes
answer in 2–5 ms.

## Cause
The test builds a FastAPI app per case and sets it on `case.operation.app` / `case.operation.schema.app`.
The pytest items hold those operations for the whole session, so every app (routers, job runner, agent
runner) stays reachable. Live objects grew 2.4M → 6.8M over the file; gen-2 GC pauses grew to ~4 s
locally, and past 10 s on the 2–3× slower Windows CI runner, on whichever request was in flight.

## Decision
`test_responses_conform` clears `case.operation.app` and `case.operation.schema.app` in a `finally`,
and passes `timeout=60` to `case.call` as a backstop. After: 0 apps alive, worst pause 0.76 s.

## Consequence
Any new schemathesis test that sets an app on an operation must clear it after the case. A timeout that
moves between unrelated routes is a GC/leak symptom, not a slow route.
