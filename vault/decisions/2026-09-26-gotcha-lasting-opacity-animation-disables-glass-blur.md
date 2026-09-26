---
type: adr
date: 2026-09-26
status: accepted
tags: [decision, gotcha, frontend, design-system]
related: ["[[2026-09-26-foundation-design]]", "[[2026-09-26-gotcha-translucent-tokens-take-no-opacity-modifier]]"]
---

# 2026-09-26-gotcha-lasting-opacity-animation-disables-glass-blur

## Context

Aero glass blurs only in `.glass-float` (`GlassPanel variant="float"`: Dialog, Popover, Menu,
CommandPalette, FloatingToolbar), via `backdrop-filter`. The entrance animations (`animate-fade`,
`animate-reveal`, `animate-rise`, `animate-pop`, `animate-slide-in`) originally used fill-mode `both`.

A finished animation with fill-mode `both` or `forwards` keeps its final keyframe applied, so the
element keeps an opacity (or transform) effect even at `opacity: 1`. That makes it a backdrop root:
`backdrop-filter` on any descendant samples only what is inside that ancestor, not the page behind it.
A Dialog inside its fading overlay, or glass inside a faded-in page, silently blurs nothing. No test or
type check notices; the panel just looks flat.

## Decision

- Entrances fill `backwards` (the first keyframe holds during the delay, nothing is kept after the
  end). DS fixed this in `eff2034`; `frontend/src/ui/tailwind.test.ts` ("lets entrances end without a
  lasting effect") pins the fill-mode of every entrance.
- DESIGN.md → Glass and blur rules states the rule.

## Consequences

- SH's page transitions (and any wrapper around glass) must not use a lasting opacity or transform
  effect: no `forwards`/`both` fill, no resting `opacity`/`transform` style on an ancestor of glass.
- A new entrance animation added to `tailwind.config.ts` must fill `backwards` and be added to the
  pinning test.

## Related

- `frontend/tailwind.config.ts`, `frontend/src/ui/tailwind.test.ts`, `frontend/src/ui/ui.css`,
  `DESIGN.md`
