# EBSM replay acceptance (X Step 4): PASS after the operator's ruling

## After the ruling (re-run, 4d51cc19)

Operator ruling: a finding photo in the photo unit that has graded pixels but no region above the size
floor keeps ONE sighting, its largest fragment. The floor, the 50-region cap and the largest-first order
are unchanged, and no constant changed. Fix: commit 4d51cc19, with `kit_masks.largest_fragment` called by
`plan_photo` only when `vectorise` keeps no ring.

Re-run in a fresh scratch project ("AF acceptance EBSM 2"): 299 photos imported (0 duplicates, 75 s), the
same class mapping, kit import 20 s.

| Measure | Target | Before (67 run) | After | |
| --- | --- | --- | --- | --- |
| Findings | 78 | 67 | 78 | ok |
| Severity 2 | 77 | 66 | 77 | ok |
| Severity 1 | 1 | 1 | 1 | ok |
| Uncertain photos | 53 | 53 | 53 | ok |
| None photos | 159 | 159 | 159 | ok |
| Not assessed photos | 9 | 9 | 9 | ok |
| Patches | 78 | 67 | 78 | ok |
| Sightings (recorded, not pinned) | more than 78 | 366 | 377 | |

After the fix: 299 of 299 photos matched by path, 299 poses written, skipped 0, orphans 0, bad 0, grouping
created 78, notes 78, attachments 78. In the placement result, "none" is 299: these are the
non-primary mask-region sightings, which have no replayed patch (377 - 78 = 299).

# Before the ruling: MISS (kept for the record)

Run 2026-10-04 on task/af-x (main f764817e), acceptance backend on a scratch app-data root, scratch project
"AF acceptance EBSM". Photos: the 299 files of the NAS GEOTAGED folder, one image source,
`dedupe_threshold: 0` (299 imported, 0 duplicates, 120 s). Kit: `EBSM Digital Report\_rebuild\job\`
(photo unit, profile `stack`, surface.json present, GLB from `../../downloads`).

Class mapping: one catalogue defect type per kit class, named after the kit label
(`moderate` -> "Moderate visible rust", `light` -> "Light visual staining / surface oxidation").

## Dry run
299 of 299 photos matched (all by path). Statuses: finding 78, none 159, uncertain 53, not assessed 9.

## Real run (40 s)

| Measure | Target | Got | |
| --- | --- | --- | --- |
| Findings | 78 | 67 | MISS |
| Severity 2 | 77 | 66 | MISS |
| Severity 1 | 1 | 1 | ok |
| Uncertain photos | 53 | 53 | ok |
| None photos | 159 | 159 | ok |
| Not assessed photos | 9 | 9 | ok |
| Patches | 78 | 67 | MISS |
| Sightings (recorded, not pinned) | more than 78 | 366 | |

Other result fields: poses written 299; placement mode replay, patch 67, point 0, none 299, orphans 11,
bad 0; grouping created 67; notes 67; attachments 67; skipped 11, all `empty_mask`.

## Cause (diagnosed read-only with the product's own code, nothing tuned)

The 11 skipped photos are finding photos whose masks are NOT empty. surface.json has 78 patches on 78
photos, so the kit placed all 78. Each of the 11 masks holds graded pixels (classes 1 to 3) only as
many small fragments, and every fragment is smaller than the per-region floor
`max(MIN_REGION_PX, REGION_MIN_SHARE * w * h)` = max(16, 0.0002 * 2560 * 1708) = 874 preview px²
(`kit_sightings.REGION_MIN_SHARE`, the coordinator's ruling on N7). `vectorise` keeps no ring, so the
photo is skipped and its replayed patch becomes an orphan.

| Photo | Graded px | Regions | Largest three areas (px²) | Kept at 874 |
| --- | --- | --- | --- | --- |
| p081 (control, imported) | 19,398 | 23 | 9,793 / 5,718 / 500 | 2 |
| p082 | 5,493 | 73 | 676 / 552 / 492 | 0 |
| p083 | 6,400 | 88 | 570 / 468 / 464 | 0 |
| p084 | 11 | 2 | 3 / 0 | 0 |
| p085 | 6,971 | 76 | 613 / 574 / 561 | 0 |
| p086 | 3,962 | 46 | 634 / 632 / 259 | 0 |
| p089 | 3,839 | 36 | 696 / 660 / 620 | 0 |
| p090 | 1,305 | 10 | 666 / 90 / 74 | 0 |
| p148 | 5,924 | 24 | 854 / 744 / 676 | 0 |
| p251 | 3,920 | 89 | 454 / 286 / 170 | 0 |
| p295 | 6,126 | 95 | 808 / 391 / 347 | 0 |
| p296 | 4,188 | 71 | 720 / 514 / 188 | 0 |

Skipped keys (job result): p082, p083, p084, p085, p086, p089, p090, p148, p251, p295, p296.
p082 to p090 are the flare-tip photos the kit notes as "heat-affected, uncertain (purple)": the moderate and
light pixels are scattered among class 4 (uncertain).

Options for the ruling (none applied):
1. A finding photo with graded pixels but no region over the floor keeps one sighting anyway (its
   largest region, or the union's bounding polygon), so every kit finding photo is one finding.
2. Lower the floor (`REGION_MIN_SHARE`) until the 11 photos keep a region.
3. Accept 67 and amend the target.
