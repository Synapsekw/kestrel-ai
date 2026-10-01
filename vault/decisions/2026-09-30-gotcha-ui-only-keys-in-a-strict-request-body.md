---
type: adr
date: 2026-09-30
status: accepted
tags: [decision, gotcha, contract, frontend]
related: ["[[2026-09-20-gotcha-openapi-default-makes-a-field-required-in-typescript]]"]
---

# Gotcha: a UI-only key in a strict request body is a runtime 422 that TypeScript does not catch

## Context

S1's new request schemas have `additionalProperties: false`, so the backend answers 422 to any
unknown property. The setup draft extends contract types with UI-only fields: `DraftType =
CatalogueTypeSpec & { key }`, `DraftBucket = InspectBucket & { id, skipped }`, and the severity-rules
editor's rows carry a `RuleDraft` key. TypeScript's excess-property check applies only to object
literals: passing a `DraftType` variable (or `{ ...draftType }`) where a `CatalogueTypeSpec` is
expected compiles cleanly, and the request fails only at runtime.

## Decision

Map draft objects to request bodies field by field, never by spreading or passing the draft object.
`importPlan.ts` `typeSpecs` reuses U5's `specOf`, which names every field and emits each severity rule
as `{when, severity}` only. The setup page's rules editor keeps its `RuleDraft` keys in the type
row's local state, and only rules with a non-blank condition reach the draft. The ensure call goes
through U5's `ensureTypes` wrapper (`api.ts`), not a direct client call. Tests assert the request
body's exact key set (`importPlan.test.ts`, `dispatch.test.ts`, and `e2e/setup-journey.spec.ts`
compares `Object.keys` of every `ensure` spec).

## Consequences

- Any future request built from a draft type (templates saved from the page, S2's proposals) needs
  the same field-by-field mapping and a key-set assertion.
- A UI-only key kept in component-local state, not in the draft, cannot leak into a body by a spread.
