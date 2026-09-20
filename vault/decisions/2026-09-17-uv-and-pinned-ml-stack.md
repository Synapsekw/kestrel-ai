---
type: adr
date: 2026-09-17
status: accepted
tags: [decision]
related: []
---

# Python dependency management: uv and a pinned ML stack

## Context

The backend needs a reproducible Python environment across dev machines, including a large,
version-sensitive ML stack (torch/CUDA).

## Decision

`uv venv --python 3.11.15` under `backend/.venv`, installed via
`uv pip install -r requirements-dev.txt`. The ML stack is pinned to the reference machine; app
libraries are pinned by `requirements-lock.txt` produced after the first install.

## Rationale

`uv` is fast and reproducible. Pinning the ML stack to the reference machine avoids CUDA/torch
version drift; locking app libraries after first install captures a known-good resolution.

## Consequences

- Positive: reproducible environment creation; ML stack version drift avoided.
- Negative: the ML stack pin is tied to the reference machine, so a different GPU/driver
  combination may need its own pin.
- Open follow-ups: none.

## Related

-
