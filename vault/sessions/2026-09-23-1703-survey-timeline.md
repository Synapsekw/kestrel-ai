---
type: session
date: 2026-09-23-1703
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-09-23-1655-geotiff-maps]]", "[[2026-09-22-1758-cleanup-a-and-acceptance]]"]
---

# 2026-09-23-1703-survey-timeline

## What changed

Two blocks in one session. The first (cleanup batch A, the rebuild and acceptance 8/8) is logged in
[[2026-09-22-1758-cleanup-a-and-acceptance]]. This note covers the second: **counts over time**.

**A design that was killed by measurement** (`a08116f`, `f207e44`, `418f4c1`). The operator asked
for counts per flight, so `2026-09-23-object-counts-per-group-design.md` proposed counting distinct
objects from overlapping drone frames: read the camera attitude at import, project each box onto the
ground, merge repeat sightings. Before planning it I measured the projection on the operator's real
project, using attitude from the original senseFly XMP (the imported copies drop it). Median distance
from a sighting to the nearest same-class sighting in the next frame:

| flight 0033 | median |
| --- | --- |
| no projection (boxes at the frame's GPS) | 28.4 m |
| projected, model detections | 16.7 m |
| projected, human-verified boxes only | 10.9 m |

A few metres is needed for merging to be trustworthy, and the best-fitting angle convention differed
between flights `0031` and `0033` — the signature of fitting noise. Meanwhile the GeoTIFF maps
feature had merged (`759015a`) and already counts per class on an orthomosaic, exactly and without
overlap. The spec is marked **superseded, never implemented**, carrying those numbers.

**The successor, built** — spec `3a1f88a`, plan `460a003`, implementation `d92441d..ddc95f6`
(8 tasks, one worktree, merged and pushed `e6e5f7d..ddc95f6`, worktree removed and branch deleted):

- `d92441d` `GeoMap.captured_on` (migration `0006`), exposed on `GeoMapOut`, editable through a new
  `PATCH /maps/{mapId}`.
- `7bbc853` import reads it from `TIFFTAG_DATETIME` and never overwrites a hand-corrected date.
  **It also fixes a bug this change introduced:** the `source.json` sidecar could not serialise a
  `date`, which failed *every* map import. Caught by an end-to-end import test, not by the unit tests.
- `77a2e45` `app/maps/timeline.py`: which run speaks for a survey, and which surveys may be
  subtracted. 10 unit tests.
- `b9c14aa` contract: `SurveyTimeline`, `Survey`, `GeoMapPatch`, `getSurveyTimeline`, client regenerated.
- `cf64e68` `GET /survey-timeline` with a choosable basis. 5 API tests.
- `573b22b` the Surveys screen: sidebar entry, route, table with deltas and state pills, empty state,
  refresh when a `map_detect` job finishes. A `trend` icon.
- `fcd1516` the chart: inline SVG in the training-curve idiom (gridlines, dates, caption), class
  legend toggles, hollow points for surveys that are not comparable.
- `ddc95f6` browser tests and evidence.

Gate on the merged result: contract check, ruff, **995 pytest**, lint, **644 vitest**, build,
**65 e2e**; `cargo test` skipped (no sidecar in a fresh worktree). Evidence:
`docs/evidence/surveys/2026-09-23-surveys-screen.png`.

## Why

The pitch promises "reviewed counts per flight", and the app only ever showed sighting totals. The
honest version of that promise turned out to be counts per **survey**, on the orthomosaic the maps
feature already counts exactly — plus the one guard that makes a trend meaningful: a survey counted
with another model or confidence is marked and excluded from the deltas, so a change of model can
never read as a change on the ground.

## Open threads

- **The installed app predates this.** The 2026-09-23 installer carries maps and the project agent,
  not the survey timeline. A rebuild is owed; the operator wants it once the other sessions' work
  (`pointcloud-spike`, `train-detect-spec`, both active worktrees) lands.
- **Unproven on real data.** Every test uses synthetic rows or the Prism mock. Nobody has yet put two
  real orthomosaics of one site in a project and read the trend — it shares that gap with the maps
  walkthrough, whose step 8 (GeoPackage in QGIS) is also unrun.
- **The de-machinery pass** the operator approved is still not started: "No machinery (N)", the
  default class list on the Projects screen, the agent placeholders.
- No Excel export and no zone-scoped trends; both deliberately out of v1 (spec §2).
- Three sessions were writing to `main` today. `start-task.ps1` branches from `origin/main`, which was
  behind local `main`, so this worktree had to be reset onto local `main` and its `node_modules`
  reinstalled before `ol`/`proj4` resolved.

## How to test

1. Open a project that has at least two imported maps of the same site.
2. On **Maps**, run the same model at the same confidence over each map.
3. Click **Surveys** in the sidebar. Expect one row per map, newest first, counts per class, and the
   change since the previous survey (`+3`, `-1`, `=`), with a chart above the table.
4. Toggle a class in the legend: its line disappears.
5. Run one map again at a different confidence. That row now reads "not comparable" with the reason,
   its point is hollow in the chart, and it is skipped when the next survey's change is computed.
6. A map with no run at all reads "not counted yet". A map with no date shows its import date, marked.

## Next session entry point

Rebuild and install once `pointcloud-spike` and `train-detect-spec` land, then walk the operator
through Surveys on real orthomosaics. After that, the de-machinery pass (domain-neutral wording,
no preset classes).
