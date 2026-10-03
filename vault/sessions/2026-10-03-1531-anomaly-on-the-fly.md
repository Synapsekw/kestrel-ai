---
type: session
date: 2026-10-03-1531
branch: main
trigger: wrapup
status: complete
tags: [session]
related: []
---

# 2026-10-03-1531-anomaly-on-the-fly

## What changed

- One commit on `main`, `26a3b90a` `feat(frontend): name an anomaly while marking a photo, map or point cloud`. 22 files, +567 / −63, all under `frontend/`. Not pushed (`main` is 2 commits ahead of `origin/main`).
- A drawn mark can create its defect type on the spot. `addProjectType` creates the catalogue type (or reuses one of the same kind, and unarchives it), appends it to the project's type list, and `publishProject` updates every open `useProject`.
- Photos: a box, polygon, rotated box, point or smart polygon drawn with no active type is held and committed when a type is picked or named (`toolApi`, `TypePicker`).
- Maps: the finding type picker names a new defect; the evaluate screen holds a box when the project has no class and names it from the label panel.
- Point clouds: the pin draft card can name a new defect and then create the finding.
- Setup copy now says types can be named later while marking a photo, a map or a point cloud.

## Why

- Marking required anomaly types chosen at project setup. With none, a drag on a photo was discarded ("Pick a type first"), a map box was dropped, and the map and cloud pickers only listed existing defect types. The operator asked to name the anomaly on the mark itself.

## Open threads

- **Video is not covered.** There is no video annotation surface. Slot import still says video is coming (S4). Naming a type while marking a video was not built.
- **Not installed, and not tried in the app.** The checks that ran were eslint and prettier on the touched files, plus vitest for those files (type picker, pin callout, pin feature, label panel, canvas keys, smart polygon, `addProjectType`). The full frontend gate, backend, contract and e2e were not re-run.
- **Unpushed:** `main` at `26a3b90a` is 2 commits ahead of `origin/main`.
- Left unstaged, not this block: the modified `AGENTS.md` (the contract-first numbered rule was removed) and the untracked `docs/superpowers/{specs,plans}/2026-10-03-delete-project-data*`.

## How to test

1. Open a project that has no anomaly types. On a photo, drag a box. The picker should say "Name the anomaly you just marked." Type a name and choose Create. The box stays, coloured as that type.
2. On a map, add a finding point or polygon, then name it in the picker. On map evaluation with no classes, drag a box and name it in the Labels panel. The box is saved as that type.
3. On a point cloud, click to drop a pin, name the anomaly on the card, then Create. The finding uses that type.
4. On a project that already has types, the same name field still adds a new one. A name that already belongs to an object is refused.

## Next session entry point

- Push `main` if this should leave the machine. Then, if wanted: the same naming on video once S4 exists, and a pass through the app on a project with no types.
