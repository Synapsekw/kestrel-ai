---
type: ledger
plan: docs/superpowers/plans/2026-09-26-foundation-s2-app-screens.md
branch: task/f-s2
---

# F-S2 ledger

## Preflight (Task 1)

| Assumed name | Real name on main | Action |
|---|---|---|
| `routes/appRoutes.tsx` redirects with `Navigate` | Uses `Redirect` (from `@/app/lazyScreens` conventions), not `Navigate` | Task 8 imports/uses `Redirect`, e.g. `<Redirect to={() => "/models/library"} />` |
| `StatusDot`'s status type is assumed to be named after the component | Exported as `DotStatus` from `@/ui` | Reference the type as `DotStatus`, not `StatusDotStatus` |
| Only `api/catalogue.ts` exports a `TypeKind` | `@/ui` also exports its own `TypeKind` | Never import both `TypeKind`s into one file; keep `api/catalogue.ts`'s `TypeKind` scoped to files that don't also import `@/ui`'s `TypeKind` |
| 503 `catalogue_unavailable` carries `details.folder` | Backend (`catalogue/handle.py:96`) always sends `details: {}`, never a folder | Keep the no-folder path as the primary assertion in `unavailableFolder` tests; the folder-present branch is dormant, kept only in case a later change adds it |
| GET `/jobs` has no fixed assumed operationId | Real operationId is `listAppJobs` | Use `listAppJobs` wherever an operationId is named for this path |
| POST `/library/training-runs` has no fixed assumed operationId | Real operationId is `startTrainingRun` | Use `startTrainingRun` wherever an operationId is named for this path |

Legacy files present at start:

```
frontend/src/screens/DatasetsScreen.tsx        -- absent (SH deleted it)
frontend/src/screens/TrainScreen.tsx           -- absent (SH deleted it)
frontend/src/screens/LabelResolverScreen.tsx   -- absent (SH deleted it)
frontend/src/screens/PastDetectionsScreen.tsx  -- absent (SH deleted it)
frontend/e2e/train.spec.ts                     -- absent (SH deleted it)
frontend/e2e/past-detections.spec.ts           -- absent (SH deleted it)
frontend/src/datasets/DatasetDetail.tsx (+ test)     -- present
frontend/src/datasets/DatasetList.tsx (+ test)       -- present
frontend/src/datasets/NewDatasetForm.tsx (+ test)    -- present
frontend/src/datasets/splitAdvice.ts (+ test)        -- present
frontend/src/api/datasets.ts                   -- present
frontend/src/train/useDatasets.ts              -- present
frontend/src/settings/ClassesSection.tsx       -- present
```

## Tasks

| Task | Commit | Notes |
|---|---|---|
| 1 | (filled in below by the commit that lands this ledger) | API wrappers, `normaliseName`, fixtures, `catalogueRevision` |
