---
type: adr
date: 2026-09-20
status: accepted
tags: [decision, gotcha]
related: []
---

# Gotcha: the Tauri capability allowlist is a runtime check

## Context

`frontend/src-tauri/capabilities/default.json` names the sidecar binary twice, once under
`shell:allow-execute` and once under `shell:allow-spawn`. During the rename, the sidecar binary
name changed from `machinery-backend` to `kestrel-backend`.

## Decision

Both allowlist entries must be updated to the current sidecar name
(`binaries/kestrel-backend`). A stale name here compiles, installs and launches cleanly — Tauri
does not validate the allowlist against the actual sidecar binary at build time — then denies the
spawn at runtime, so the app has no backend. No test in the repo catches this; the only check is
launching the built app and hitting `/api/v1/health`.

## Rationale

The allowlist is enforced at runtime, not build time, so a name mismatch produces no compile or
install error — only a silently broken app. Treating it as part of the rename's file-by-file map
(rather than something the build would catch) is the only way to not miss it.

## Consequences

- Positive: sidecar spawn permission stays correct across a rename.
- Negative: this class of bug has no automated test; every rename or sidecar-name change needs a
  manual launch-and-health-check pass.
- Open follow-ups: none.

## Related

-
