---
type: adr
date: 2026-09-21
status: accepted
tags: [decision, gotcha]
related: ["[[2026-09-21-1920-setup-agent]]"]
---

# Contract-generated background jobs need an offline external-work seam

## Context

Contract conformance exercises every endpoint with generated request bodies. The new starter acquisition endpoint returns a job immediately and its runner can then download a real YOLO checkpoint. An absent starter folder alone no longer prevents external work, unlike the earlier synchronous bundled-only endpoint.

## Decision

The shared backend `app` test fixture replaces `app.training.starter_download.download_weights` with a clear JobFailure before creating the app. Focused acquisition tests replace that seam with controlled responses and temporary files. Real downloads are never an implicit consequence of schema fuzzing.

## Rationale

An HTTP 202 says nothing about side effects performed by the worker afterward. Isolating the external-work seam keeps contract tests bounded, offline and independent of large model files while dedicated tests verify streaming, cancellation, truncation and publication behavior.

## Consequences

- Positive: contract tests cannot download arbitrary catalog choices or load newly downloaded checkpoints.
- Negative: generic contract success verifies the accepted-job response, not eventual model acquisition; dedicated tests must cover the worker.
- Open follow-ups: apply the same audit whenever another job-creating endpoint adds an external side effect.

## Related

- `backend/tests/conftest.py`, `backend/tests/test_starter_download.py`
- `backend/app/training/starter_download.py`
