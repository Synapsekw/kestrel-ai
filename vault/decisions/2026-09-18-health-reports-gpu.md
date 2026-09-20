---
type: adr
date: 2026-09-18
status: accepted
tags: [decision]
related: []
---

# Health endpoint reports GPU

## Context

The packaged smoke test needs to confirm GPU visibility, but the health endpoint must stay fast
since it's polled frequently.

## Decision

Add optional `Health.gpu` `{available, name}` to the contract (f52267c). It is probed once in a
background thread after the first health request, not on every request, so health stays fast.

## Rationale

Probing GPU visibility on every health call would slow it down; probing once in the background
and caching the result gives the smoke test what it needs without that cost.

## Consequences

- Positive: packaged smoke test can verify GPU visibility via the health endpoint.
- Negative: the GPU field is not available on the very first health response (probe runs after
  it).
- Open follow-ups: none.

## Related

-
