---
type: adr
date: 2026-09-17
status: accepted
tags: [decision]
related: []
---

# Mock server and client generator

## Context

The frontend needs a mock API server to develop against the contract, and a typed client so
frontend code doesn't hand-write request/response shapes.

## Decision

Stoplight Prism serves `openapi.yaml` on `127.0.0.1:4010`. `openapi-typescript` generates
`contract/client/schema.d.ts` from the same spec, and `openapi-fetch` wraps it for typed calls.

## Rationale

All three tools consume the same `openapi.yaml`, so the mock server and the generated types can
never drift from each other or from the real backend's contract.

## Consequences

- Positive: frontend can develop against a contract-accurate mock before the backend exists.
- Negative: another moving part (Prism) to run alongside the dev backend and Vite.
- Open follow-ups: none.

## Related

-
