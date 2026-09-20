---
type: adr
date: 2026-09-17
status: accepted
tags: [decision]
related: []
---

# S0 sidecar excludes torch

## Context

Checkpoint 1 needs to prove the PyInstaller sidecar boot mechanism quickly. Building the full
CUDA/torch stack into that first sidecar would slow the checkpoint down for no benefit at that
stage.

## Decision

The S0 sidecar is a PyInstaller build that excludes torch. S6 is the one that produces the full
CUDA build.

## Rationale

Checkpoint 1 only needs to prove the sidecar boots and serves the API; torch and CUDA add build
time and size without helping that goal.

## Consequences

- Positive: checkpoint 1 stays fast to build and verify.
- Negative: the S0 sidecar cannot run real inference; that's deferred to S6.
- Open follow-ups: none.

## Related

-
