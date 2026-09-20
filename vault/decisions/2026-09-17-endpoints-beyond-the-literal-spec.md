---
type: adr
date: 2026-09-17
status: accepted
tags: [decision]
related: []
---

# Endpoints beyond the literal spec

## Context

Spec section 9 lists endpoints literally, but implementing the described behavior needs a few
more that the list doesn't spell out.

## Decision

Add `GET /projects` (recent), `PATCH /projects/{p}` (settings),
`POST .../images/{id}/preannotate`, `POST .../models/train`, `POST .../query-runs/estimate`,
`POST .../images/bulk-delete`, and `GET /projects/{p}/stats`. Each is tied to another spec
section and recorded in the S0 plan.

## Rationale

Each endpoint exists to satisfy behavior spec section 9's list assumes but doesn't enumerate;
adding them keeps the API complete without contradicting the spec.

## Consequences

- Positive: API surface matches the behavior the spec actually requires.
- Negative: the endpoint list is now spread across section 9 and the S0 plan; a reader needs
  both.
- Open follow-ups: none.

## Related

-
