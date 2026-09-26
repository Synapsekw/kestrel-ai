---
type: adr
date: 2026-09-26
status: accepted
tags: [decision, gotcha, frontend, design-system]
related: ["[[2026-09-26-foundation-design]]"]
---

# 2026-09-26-gotcha-translucent-tokens-take-no-opacity-modifier

## Context

Aero glass surfaces are translucent white over an indigo backdrop. `index.css` stores them as complete
`rgba()` values (`--surface: rgba(255, 255, 255, 0.055)`) and `tailwind.config.ts` exposes them as
`var(--surface)`. Opaque colours stay RGB triplets (`--ink: 242 241 251`) exposed as
`rgb(var(--ink) / <alpha-value>)`.

Tailwind can only apply an opacity modifier to a colour it can parse or to one with `<alpha-value>`.
For `bg-surface/80` it has neither, so the class does not produce the intended colour and the element
silently loses its background. No test or type check notices; it only shows on screen.

## Decision

- `frontend/scripts/check-tokens.mjs` rule `translucent-modifier` fails `pnpm -C frontend lint` on
  `<utility>-<translucent token>/<n>` outside `src/ui/**`.
- Tokens read from JavaScript (`tokenRgb`, `tokenColour`) must be triplets; `src/ui/tokenReads.test.ts`
  checks every literal read.

## Consequences

- A translucent surface is used as is; for a stronger or weaker tint use the next token
  (`surface` → `surface-2`) or add a token.
- Renaming or re-typing a token that JavaScript reads now fails a test instead of drawing `NaN`.

## Related

- `frontend/src/index.css`, `frontend/tailwind.config.ts`, `frontend/scripts/check-tokens.mjs`,
  `frontend/src/ui/tokenReads.test.ts`
