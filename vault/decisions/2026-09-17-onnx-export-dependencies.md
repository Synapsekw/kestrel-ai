---
type: adr
date: 2026-09-17
status: accepted
tags: [decision]
related: []
---

# ONNX export dependencies

## Context

Model export to ONNX needs specific Python packages that weren't yet in the backend's
requirements.

## Decision

Add `onnx`, `onnxslim` and `onnxruntime` to `requirements.txt`. Whether to also add TensorRT is
deferred to S6.

## Rationale

These three packages are what ONNX export actually needs; TensorRT is a separate, heavier
decision better made when S6 addresses the full packaging story.

## Consequences

- Positive: ONNX export works without pulling in TensorRT prematurely.
- Negative: TensorRT support remains an open question until S6.
- Open follow-ups: S6 decides TensorRT.

## Related

-
