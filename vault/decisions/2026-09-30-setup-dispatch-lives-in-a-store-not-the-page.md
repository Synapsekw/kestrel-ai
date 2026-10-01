---
type: adr
date: 2026-09-30
status: accepted
tags: [decision, setup, frontend]
related: ["[[2026-09-30-project-setup-design]]"]
---

# The setup dispatch lives in a store, not in the setup page

## Context

Create project must open the new project's Overview at once, while one request per import is still
going out (a delivery can hold hundreds of files, and a drawing waits on its inspect job for up to
ten minutes). Code in the setup page's effects or event handler dies with the page when it
navigates, and a promise chain held by an unmounted component has nowhere to report a failure.

## Decision

`runSetup` (`frontend/src/setup/dispatch.ts`) awaits only the type ensure (through the `ensureTypes`
wrapper in `api.ts`) and `POST /projects`, then hands the import plan to `useSetupImports`, a
module-level zustand store, without awaiting it. The store marks every unit pending synchronously,
starts them one request at a time (drawings last), and keeps each unit's state and error per
project. The Overview's `SetupNotice` reads the store; Retry and Dismiss are store actions.

## Consequences

- The imports keep starting whatever screen the operator opens; the notice is there when they
  return to the Overview.
- The store is not persisted: after an app restart the notice is gone, and the started jobs remain
  in Jobs. A request still in flight at shutdown is lost, as any request is.
- A dismissed project's late answers are dropped (the store ignores patches for a project it no
  longer holds).
- Pinned by `dispatch.test.ts` ("keeps starting the imports after runSetup returned") and
  `useCreateProject.test.tsx` ("opens the new project's Overview before its imports have started").
