---
type: adr
date: 2026-09-18
status: accepted
tags: [decision]
related: []
---

# Wave 1 contract additions

## Context

During Wave 1 implementation, the goal owner found gaps in the existing contract that needed
closing before S3/editor work could proceed cleanly.

## Decision

`ModelImport.weights_path` gets `minLength: 1` (so S3 can answer 422 on empty input);
`ExportRequest.half` is documented (onnx on CPU, engine on GPU 0); `BoxReview.action` gains
`unreview` (undo of accept/reject; person boxes are ignored). In the editor, Delete on a proposal
means reject.

## Rationale

Each addition fixes a concrete gap found while implementing against the contract, decided by the
goal owner rather than left ambiguous per sub-project.

## Consequences

- Positive: contract now covers validation and undo behavior the implementation needed.
- Negative: contract changed mid-wave, so sub-projects had to pick up the update.
- Open follow-ups: none.

## Related

-
