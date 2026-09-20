---
type: adr
date: 2026-09-17
status: accepted
tags: [decision]
related: []
---

# Port allocation

## Context

Several dev-time processes (backend, mock server, Vite) need fixed ports that don't collide with
each other or with the existing Label Studio workflow.

## Decision

Backend dev port 8765 (the launcher picks a free port in the packaged app), mock server 4010,
Vite 1420. Ports 8080 and 9090 are left alone for the existing Label Studio workflow.

## Rationale

Fixed dev ports make it predictable which process is which; 8080/9090 are avoided because
Label Studio already uses that range for this project.

## Consequences

- Positive: no port collisions between this app's dev servers and Label Studio.
- Negative: the packaged app still needs its own free-port search since a fixed port isn't safe
  on an arbitrary operator machine.
- Open follow-ups: none.

## Related

-
