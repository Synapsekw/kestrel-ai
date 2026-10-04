---
type: session
date: 2026-10-04-1900
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-10-02-2300-asset-model-builder-m1]]"]
---

# 2026-10-04-1900 plant model generator G1

## What changed

The operator said M1 "is not done properly". Investigation found the cause was scope, not bugs:
- **Cowork's KIPIC Al-Zour model** was a whole plant traced from four plot plans: 864 items, 46 types.
- **Kestrel's M1 run** on the LNG Terminal project built one tank in 3 parts (1.2 M tokens), from page 1 of the overall plan only.

The operator approved a redesign (C: plant → items → parts, approach A: an AI-typed register plus app builders), to be run as a goal.

**Spec and plans**
- Spec `docs/superpowers/specs/2026-10-03-plant-model-generator-design.md` (`e7c53097`).
- Plan index plus 10 unit plans `docs/superpowers/plans/2026-10-03-plant-model*.md` (merged `9c27f3cf`).

**12 units merged to `main`, via per-unit controller sub-agents in `.claude/worktrees/pm-*`:**

| Unit | Merge | What it built |
| --- | --- | --- |
| F0 | `76349096` | Contract, migration 0017 (`asset_item`, `site_model_package`, `asset_model.kind`), spec models, `siteframe`, builder registry, palette, instancing |
| A1 | `872dc0ed` | GLB assembler, CSV, items routes, P1 frame fill |
| B1 | `50a06d69` | Structure builders |
| B3 | `9528777d` | Building, civil and environment builders |
| C1 | `f0df160b` | Cloud check |
| K1 | `a6bb043d` | Scorer and live test |
| B2 | `80ea1f16` | Equipment builders |
| I1 | `49dda868` | All-pages PDF import, unimported-drawings scan |
| S1 | `5dcc8707` | Site 3D core |
| S2 | `e879fb57` | Cloud, water, sky, photos and findings layers |
| R1 | `bdff5806` | The plant run: orchestrator, parallel sub-runs, plant tools, prompts, resume |
| S3 | `e384fe55` | Panels: layers, register, item editor, run bar, entry points |

Across the G1 code paths this is 147 files and +25 080 lines.

**L1: live Al-Zour runs and their fixes** (merged `01f85f14`):

| Commit | Fix |
| --- | --- |
| `3d2fba22` | The live test imports the plot plans into a copy and reads the key from Credential Manager |
| `9365e049` | A stated frame wins over a grid fit; shorelines come from the largest-scale plan; must-haves are matched by geometry |
| `a1ce9f63` | A busy or dropped provider is retried; a failed package is re-run once; land is traced to the revetment toe |
| `07a1eec7` | Anthropic calls stream with 64 k output tokens and SDK retries |
| `401c17b3` | The scorer matches tag ranges and alternatives by their member tags |

The coordinator fixed the catalogue listing so it fits the 8 000-character tool reply cap (`b35e9a53`).

**Live run results** (estimates from list prices):

| Run | Recall | Type match | Within tolerance | Tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| 1 | 96.3 % | 92.8 % | 85.4 % | 26.7 M | $117 |
| 2 | 89.1 % | 86.4 % | 88.2 % | 25.9 M | $112 |
| 3 | — | — | — | 2.6 M | ~$12 |
| 4 | 89.1 % | 80.2 % | 81.8 % | 37.1 M | $163 |

Run 3 failed in the survey: the answer was cut off. Evidence is in `docs/evidence/2026-10-03-plant-model-g1/run1..run4/`, plus `README.md`.

**Installer**
- Built from `01f85f14` in `pm-int` and installed. The backend smoke check printed `asset-models ok 576 12092`.
- The build needed `backend/starter_weights` and `backend/third_party` copied into the worktree.

**Review project and acceptance**
- `E:\Asset Inspections\LNG Terminal - Kestrel plant model`: run 2's state with a new project id, the point cloud octree and asset model files copied in, and an entry added to `recent_projects.json`.
- The operator viewed the plant in Site 3D and **accepted** it: "slightly different from the cowork model but it should be fine".

**Close-out:** the acceptance note and the helper copying `asset_models` (`0eefe4b0`) are merged as `5e1b7b3f` (merge gate 2203 passed).

## Why

The operator wants Cowork-quality plant models (a typed register, a GLB and a CSV, layered over the ortho and point cloud with water and sky) produced repeatably inside Kestrel from drawings plus a scan, for any project. M1's single-asset, millimetre-part design could not represent a plant.

## Open threads

- **The scorer targets were not met** (spec §13: ≥95 % type match, within tolerance, land Hausdorff ≤10 m); the operator accepted on review instead.
  - **Granularity:** skid components and single pumps are often written as one package, which hits area 50/70 recall.
  - **Run-to-run variance** is high in package planning.
  - **Land outline:** worst point is 118–197 m off.
- **Asset models default pick prefers an asset model.** In a project with both kinds, the operator landed on the old tank. Plant models are reached via the picker or Maps → "Open site in 3D". There is no sidebar entry for Site 3D. A UX fix is owed.
- **The operator's real `LNG Terminal` project has no plant model**; only the review copy has one. A real in-app run on that project costs about $120–160 and takes about 75 min.
- **Latent bug outside G1:** `GET site-tiles/{kind}/{layerId}/…` returns 500 on astral-unicode layer ids. It is intermittent in `test_contract`.
- **Housekeeping:**
  - live test copies in `.superpowers/sdd/pm-common/live/tmp1..tmp4`, about 1 GB each, deletable;
  - worktrees `pm-l1` and `pm-int` are left.
- **G2** (points and pictures on items, with artifact-port P1) and **G3** (media and flights) are not started.

## How to test

1. Start Kestrel AI (installed from `01f85f14`) and open the project **LNG Terminal - Kestrel plant model (run 2)** from Projects.
2. Maps → **Open site in 3D**, or Asset models → model picker → **Al-Zour LNG plant (acceptance)**. Expect the plant over the draped ortho, with the point cloud placed and the plot plans available as layers.
3. Layers panel: toggle water, sky, cloud and drawings; colour by type or area. The water animates and the sky shows a sun.
4. Register: search `20-T-0003`. The row flies to the tank and the item panel shows its row, flags and source.
5. Edit an item's height and Save. A new version builds and the view swaps, keeping the camera.

## Next session entry point

Ask the operator whether to (a) fix the Asset models default pick and add a Site 3D entry point, (b) run the generator on their real LNG Terminal project, or (c) start G2/M2 brainstorming with the artifact-port session. The coordinator log is `.superpowers/sdd/pm-common/coordinator.md`; the rulings are in `handoffs.md`.
