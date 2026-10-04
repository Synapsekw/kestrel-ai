# DAMAC replay acceptance (X Step 2): PASS after the keep-every-photo ruling

## Run (2026-10-04, task/af-x with e643692d)

The first run lost 43 photos at import (see "Before the ruling" below). Operator ruling: add a real
"Keep every photo" import option (`ImportSettings.keep_duplicates`), which turns the duplicate check off.
It is built in commits e643692d and eeed7582.

Setup:
- The acceptance backend ran on a scratch app-data root, with a fresh scratch project, "AF acceptance DAMAC 2".
- Photos: the 4,538 files that the kit's cameras.json names, copied with their relative paths into a scratch
  folder. They were imported as one image source with `keep_duplicates: true`: 4,538 imported, 0 duplicates, 0 failed, 330 s.
- Kit: `DAMAC Hills Tower Facade Digital Report\_rebuild\job\` (region unit, profile `building-facade`, with
  surface.json, merged.json and model.glb).
- Class mapping: one catalogue defect type per kit class, named after the kit label.

| Measure | Target | Got | |
| --- | --- | --- | --- |
| Kit photos matched | 4,538 | 4,538 (all by path) | ok |
| Findings | 656 | 656 | ok |
| Severity 2 | 182 | 182 | ok |
| Severity 1 | 474 | 474 | ok |
| Sightings | 1,441 | 1,441 | ok |
| Patch | 715 | 715 | ok |
| Point | 625 | 625 | ok |
| None (unplaced) | 101 | 101 | ok |
| Uncertain photos | 45 | 45 | ok |

Other result fields:
- kit import: 60 s;
- poses written: 4,538;
- statuses: finding 1,136, none 3,357, uncertain 45, not assessed 0;
- placement: mode replay, orphans 0, bad 0;
- grouping: created 656; notes 656; skipped 0.

## Sightings CSV against the kit CSV

The Kestrel CSV is a report render with `csv_layout: asset_sightings`. The kit CSV is
`downloads\DAMAC-Hills-Tower-Facade-findings.csv`.

Matching rule: the same photo, the kit class mapped through the import mapping, and a box centre within 2 px of the stored image.
- Kestrel side: CSV row, then its sighting (by file name, class and coverage), then its box centre.
- Kit side: CSV row, then its assessment finding (by photo, class and note, with coverage as the tie-break), then the
  centre of that finding's merged.json polygon (or bbox), scaled from the kit preview grid.
- The kit CSV's coverage column is not always the box coverage (some rows read 0.0000), so it serves only as a tie-break.

| Measure | Result |
| --- | --- |
| Rows (Kestrel / kit) | 1,441 / 1,441 |
| Matched | 1,441 (0 unmatched on either side) |
| Largest centre distance | 0.067 px |
| Grouping agrees (kit defect_id partition equals Kestrel finding partition) | 1,441 / 1,441 |
| Severity agrees | 1,441 / 1,441 |
| Placement agrees (placed_on_model) | 1,441 / 1,441 |
| Side agrees (side_approx) | 1,441 / 1,441 |

GLB frame:
- The kit model.glb bounds are x -20.67 to 43.78, y 0 to 74.4, z -25.24 to 10.63.
- It is base-levelled (y from 0) but not base-centred in X and Z: the footprint centre is about (11.6, -7.3).
- Sides still agree on every row, because the kit's cameras and surface.json use the same frame.

## Before the ruling: MISS (kept for the record)

- Photos imported with `dedupe_threshold: 0` only: 4,495 imported and 43 dropped.
- Threshold 0 still drops a photo whose perceptual hash equals an earlier one. None of the 43 pairs is byte-identical.
- By folder, the drops were: Thermal 31, P1 35mm 11, p1 50mm 1.
- They included 8 finding photos, carrying 12 kit sightings.
- Kit import: 4,495 of 4,538 matched; 657 findings (183 / 474); 1,429 sightings; patch 706; point 622; none 101; uncertain 45.
