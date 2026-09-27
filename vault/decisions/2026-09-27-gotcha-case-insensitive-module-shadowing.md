---
type: adr
date: 2026-09-27
status: accepted
tags: [decision, gotcha]
related: []
---

# Gotcha: `./Foo` loads `foo.ts` instead of `Foo.tsx` on Windows

## Context

C-W1 Task 3 added the pure modules `clouds/workspace/gizmo.ts` and `minimap.ts`. Task 8's plan then
named the components that use them `Gizmo.tsx` and `Minimap.tsx`, in the same folder. On Windows the
filesystem ignores case, and Vite and vitest try `.ts` before `.tsx`. So `import { Gizmo } from
"./Gizmo"` found `Gizmo.ts`, which on disk is `gizmo.ts`, and returned the pure module. `Gizmo` came
back `undefined`, and React threw "Element type is invalid ... got: undefined".

`tsc -b` stayed green because TypeScript resolved the name to `Gizmo.tsx`. So the type check passes
while vitest, `vite build` and the running app load the wrong file. Linux CI would load the right
file, so the bug only shows on Windows.

## Decision

Never give two files in the same folder base names that differ only in case, such as a component
`Foo.tsx` next to a module `foo.ts`. Give the component a distinct name instead: here
`ViewGizmo.tsx` and `SiteMinimap.tsx`. Their exports stay `Gizmo` and `Minimap`.

## Rejected

Importing with the extension (`"./Gizmo.tsx"`, which `allowImportingTsExtensions` permits) works,
but it leaves the trap in place. The next import written as `"./Gizmo"` would fail the same silent
way, and tsc would still pass.
