---
type: adr
date: 2026-10-04
status: accepted
tags: [decision, gotcha]
related: ["[[2026-10-04-1900-plant-model-generator-g1]]"]
---

# 2026-10-04 gotcha: a copied project folder keeps its project id

## Context

To let the operator review a generated plant model without touching their real project, a copy of
`E:\Asset Inspections\LNG Terminal` was made (from the live acceptance test's copy).

- The project's id lives in `project.db` → table `project`, column `id`.
- `%APPDATA%\ai.synapse-solutions.kestrel-ai\recent_projects.json` is keyed by that id:
  `AppData.remember` drops any entry with the same id at another folder.

Opening a copy that keeps the id therefore *replaces* the original's recent entry, so the real project
appears to have moved.

Three more things went wrong with the first copy:
- The live test copied only `drawings/`, `maps/` and `pointclouds/` (no octrees), so the older asset
  model's GLB answered 409 ("3D model could not load").
- The point cloud had no octree to show.
- The operator could not find the copy at all until it was in the recent list.

## Decision

A review copy of a project gets:
- a **new uuid** in `project.id` and a distinct name;
- the **`asset_models/` folder** and the point clouds' **`octree/`** copied in;
- an entry added to `recent_projects.json`, with the file backed up first.

`plant_live_helpers.KESTREL_DIRS` now includes `asset_models`.

## Rationale

`project.id` is referenced by no other table (checked: no `project_id` columns), so changing it in the copy is
safe and leaves the original untouched. The alternatives were worse:
- Asking the operator to "Open folder" on a same-id copy silently redirects their real project's entry.
- DB surgery to merge the generated model into the real project is risky and unreviewable.

## Consequences

- Positive: the operator can review generated results side by side with the real project, risk-free.
- Negative: the copies are large (5.4 GB with the octree) and must be deleted by hand.
- Open follow-ups: a proper "Duplicate project" action in the app would do this safely; none exists.

## Related

- [[2026-10-04-1900-plant-model-generator-g1]]
