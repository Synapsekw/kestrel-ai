---
type: adr
date: 2026-09-17
status: accepted
tags: [decision]
related: []
---

# Jobs are per project

## Context

The spec does not say whether jobs are global or scoped to a project. The Job table lives in
`project.db` (spec section 4), which is itself per project.

## Decision

Jobs are per project, exposed as `/projects/{p}/jobs`. The websocket `/api/v1/events` stays
global, and every event it carries includes `project_id`.

## Rationale

Matches where the Job table actually lives (`project.db`). A single global event stream is still
useful for the UI, so only the REST surface is scoped, not the websocket.

## Consequences

- Positive: job data stays co-located with its owning project's database.
- Negative: clients consuming the global event stream must filter by `project_id` themselves.
- Open follow-ups: none.

## Related

-
