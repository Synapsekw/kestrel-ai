---
type: adr
date: 2026-09-21
status: accepted
tags: [decision, gotcha]
related: ["[[2026-09-21-2003-setup-agent-desktop]]"]
---

# Await drawer animations before asserting final layout bounds

## Context

The installed WebView2 check opened Setup agent, resized to 1024px and immediately measured its bounding rectangle. The drawer's 220ms entrance animation applies translateX(24px), so the test observed right=1040.577 while the final layout was exactly right=1024. The app fit the viewport; the test measured an intermediate frame.

## Decision

For final geometry assertions, await the element's actual animations via `getAnimations()` and their `finished` promises before measuring. Preserve a separate observation of the animation if testing motion itself. Do not add a fixed sleep or change product CSS to satisfy a transient measurement.

## Rationale

Element visibility and completed viewport resizing do not imply that a CSS entrance animation has finished. Waiting for its real completion proves the final layout without depending on machine speed.

## Consequences

- Positive: deterministic layout verification with unchanged application behavior.
- Negative: the final-bounds assertion intentionally does not verify intermediate motion frames.
- Open follow-ups: use the same pattern for future native drawer/popover geometry checks.

## Related

- `docs/evidence/setup-agent-desktop/layout-investigation.json`
- `docs/evidence/setup-agent-desktop/verify-installed.cjs`
