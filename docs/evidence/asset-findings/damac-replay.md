# DAMAC replay acceptance (X Step 2): MISS, stopped for a ruling

Run 2026-10-04 on task/af-x, acceptance backend on a scratch app-data root, scratch project
"AF acceptance DAMAC". Photos: the 4,538 files that the kit's cameras.json names (`source_name`),
copied with their relative paths into a scratch folder, so the folder holds exactly the kit's photo set.
These were imported as one image source with `dedupe_threshold: 0`.
Kit: `DAMAC Hills Tower Facade Digital Report\_rebuild\job\` (region unit, profile `building-facade`,
surface.json, merged.json and model.glb present). Class mapping: one catalogue defect type per kit
class, named after the kit label.

## Photo import: 43 kit photos dropped as duplicates at threshold 0

- 4,495 imported, 43 duplicates, 0 failed, 225 s.
- At `dedupe_threshold: 0` the importer still drops a photo whose perceptual hash equals an earlier one
  (Hamming distance 0). None of the 43 pairs is byte-identical: they are distinct photos.
  By folder: Thermal 31, P1 35mm 11, p1 50mm 1.
- Of the 43 dropped kit photos, 8 have status `finding` and 35 have status `none`. They carry 12 of
  the kit's 1,441 sightings.
- `ImportSettings.dedupe_threshold` has a minimum of 0 and there is no route that restores a recorded
  duplicate, so the app offers no way to bring them in.

## Kit import, real run (40 s)

| Measure | Target | Got | |
| --- | --- | --- | --- |
| Kit photos matched | 4,538 | 4,495 (all by path; 43 `not_found`) | MISS |
| Findings | 656 | 657 | MISS |
| Severity 2 | 182 | 183 | MISS |
| Severity 1 | 474 | 474 | ok |
| Sightings | 1,441 | 1,429 (12 skipped `photo_unmatched`) | MISS |
| Patch | 715 | 706 | MISS |
| Point | 625 | 622 | MISS |
| None (unplaced) | 101 | 101 | ok |
| Uncertain photos | 45 | 45 | ok |

Other result fields:
- poses written: 4,495;
- statuses: finding 1,128, none 3,322, uncertain 45, not assessed 0;
- placement mode: replay; orphans 12 (the replayed placements of the 12 unmatched sightings);
- grouping: created 657; notes 657; attachments 0.

Losing 12 sightings explains 9 fewer patches and 3 fewer points. The extra finding (657 rather than 656,
one more at severity 2) is consistent with one of the dropped sightings having joined two groups:
without it, the grouping splits that defect in two. I have not checked this.

The CSV comparison (kit CSV against the sightings CSV) and Step 3 (recompute) were not run, because the
replay counts already miss.

## Options for the ruling (none applied)

1. Let the importer skip duplicate detection entirely (for example, `dedupe_threshold: -1`, or a "keep
   duplicates" flag), and use it for kit photo sets.
2. Make threshold 0 mean "off" (no duplicate detection at all) rather than "identical hash".
3. Accept the photo-import loss and amend the targets to the 4,495 matched photos.
