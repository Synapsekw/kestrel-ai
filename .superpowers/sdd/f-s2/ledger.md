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
| 1 | 38e31ba | API wrappers, `normaliseName`, fixtures, `catalogueRevision`. Also fixed `exampleTrainingRun`/`exampleTrainingRun2` metrics (the brief's literal was missing `ModelMetrics`' required `precision`, `recall`, `per_class`; `tsc` caught it) and exported `TRAIN_PARAMS: TrainRequest` per the controller's ruling P4 |

## Rebased onto main 822e095 (Task 17)

Hashes below are the rebased ones (`git rebase main`, clean, no conflicts; old head dac9174).
Task 1's pre-rebase hash above (38e31ba) is superseded by 9c0d056.

| Task | Commit(s) | Notes |
|---|---|---|
| 1 | 9c0d056, b219193 | API wrappers, `normaliseName`, fixtures, `catalogueRevision`; ledger note |
| 2 | 842614a | Catalogue filter, draft and validation model, `useCatalogue` |
| 3 | 109477c | Catalogue screen, types table, type editor |
| 4 | 03653d6 | Classification banner, findings backfill offer |
| 5 | 5b5e606 | Severity editor, app-wide scale sync, catalogue e2e |
| 6 | 23a1152, 3257e49, fb49a2c | Jobs section; jobs drawer retired, toasts app-wide with "Show log" to Jobs; S1 leftovers after the rebase |
| 7 | 904e532 | Library datasets, training runs, class map wrappers and paged hooks |
| 8 | a7ce12b | Models layout, Library at /models/library |
| 9 | 3f99fff | Datasets screen (list, detail, samples, export, delete) |
| 10 | d0e5d96, 903d63f | Dataset builder with live preview; load-failure messages |
| 11 | b8d8a03, 26a5712 | Training screen; retired the per-project dataset and train operations (RETIRING dicts) |
| 12 | e5039ad | Compare two to four runs |
| 13 | bd4fcbb | Class mapping per model |
| 14 | f391fd8 | Appearance (visual effects, reduce motion) and "Your name" (backend `operator_name`) |
| 15 | 4e40904, 80a699a, 6cdd72e | Ran, and early (before Task 3): project Types list on PUT /types, retired `updateClasses` + `ClassDefInput` (schema regenerated in the same commit); hotkey override cleared with null; providers e2e follows the type list |
| 16 | none | Verify-only (ruling P14). Label next: SH's (`data/labelNext.ts` exports `labelNext(api, projectId)` returning `{imageId} \| "all-labeled" \| "no-images" \| "failed"`, not the plan's `labelNextTarget`/`useLabelNextAction`; `DataManagerScreen` calls it from its own "Label next" button, not a route action). `labelNext.test.ts` + `DataManagerScreen.test.tsx`: 10 passed. No `LabelResolverScreen`/`PastDetectionsScreen` reference left in `frontend/src` or `frontend/e2e`; `e2e/past-detections.spec.ts` absent; `routes/legacyRedirects.tsx` holds `/label`, `/past`, `/past/maps/:mapId` |
| 17 | 238d6c8, (docs commit) | Gate fix: `CatalogueSeverityProvider` swapped a fragment for the provider when the scale arrived, remounting the whole shell ~1 s after start (e2e shell "secondary pages open from More" failed deterministically). Now always renders the provider with DS's default. Walkthrough + this ledger |

### Legacy files already gone at start

`screens/DatasetsScreen.tsx`, `screens/TrainScreen.tsx`, `screens/LabelResolverScreen.tsx` (+ test),
`screens/PastDetectionsScreen.tsx` (+ test), `e2e/train.spec.ts`, `e2e/past-detections.spec.ts`
(all deleted by SH). The rest of the list in Preflight was present and removed by S2's tasks.

### Assumed names that differed

- The six in the Preflight table above (`Redirect` not `Navigate`, `DotStatus`, two `TypeKind`s,
  no `details.folder` on 503, `listAppJobs`, `startTrainingRun`).
- Task 16: `labelNextTarget` / `useLabelNextAction` → SH's `labelNext` (a status union) and a
  button in `DataManagerScreen`.
- Task 17: `node frontend/scripts/check-tokens.mjs` must run from `frontend/` (it walks `./src`);
  from the repo root it throws ENOENT.

### Task 15

Ran, early, and retired `updateClasses` (4e40904).
