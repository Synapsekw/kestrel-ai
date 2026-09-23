---
type: usability
date: 2026-09-22
---

# GeoTIFF maps — operator walkthrough

This is the "how to test this" for the GeoTIFF maps feature (spec/plan `2026-09-22-geotiff-maps`),
run on the **real app against the real backend** with a real multi-GB orthomosaic. The browser e2e
test added in Task 15 (`frontend/e2e/maps.spec.ts`) only exercises the happy path against the Prism
mock — fixed fixtures, no real raster, no real detector, no real GIS file. It is not a substitute
for this walkthrough, and this walkthrough is not a substitute for it: the e2e test is what a CI
run can check on every change; this is what proves the real thing works end to end, once, before
the operator relies on it.

Each step says what you should see. If a step does not match, stop and report which one.

1. Open a project, then **Maps** in the left rail, then **Import map**. Pick an orthomosaic `.tif`
   (use a real multi-GB one). The map appears in the list with a progress bar and becomes
   clickable when the import finishes. The source file is untouched (check its modified time and
   size before and after).
2. Click the map. It fills the centre of the screen.
   - Scroll to zoom from the whole site down to a single machine. Tiles load within about a second
     per view, with no seams between tiles at any zoom level.
   - The bottom bar shows pixel, map (EPSG) and lat/lon coordinates under the cursor, and the scale
     bar tracks the zoom level.
3. Under **Runs** on the left, click **New run**. Pick a model and check the "Model trained at
   (cm / px)" field against the map's own ground resolution shown in the hint below it. The line
   under the confidence field shows the windows to check, the empty windows skipped, and the scale
   factor if the model's GSD differs from the map's. Click **Start detection**. The run's row shows
   progress ("window n / N · k detections"); cancelling and then **Resume** (the refresh icon) both
   work and continue from where the run left off.
4. Tick the finished run's checkbox.
   - Boxes appear on the machines on the map.
   - The Results tab's table shows counts per class for the whole map; switch to **In view** to
     count only the visible area instead.
   - Move the "Minimum confidence" slider: both the boxes on the map and the counts in the table
     follow it live.
   - Zoom far out until the view holds more machines than the app will draw as individual boxes:
     they turn into density dots instead of disappearing.
5. Tick a second run. The two runs' boxes show as solid and dashed outlines respectively, with
   their counts side by side in the Results table.
6. **Labels** tab:
   - Draw a zone (the "Zone ▭" or "Zone ⬠" tool) around an area you are willing to label
     completely — only boxes inside a zone are ever scored.
   - Click **Copy detections into labels** to seed labels from a run's detections inside that
     zone, then correct them by hand: number keys `1`–`9` pick the active class, `B` starts a new
     box, dragging a selected box moves it and dragging a handle resizes it, `Del`/`Backspace`
     deletes the selected box, `Ctrl+Z`/`Ctrl+Y` undo and redo.
   - The "seeded from a run, not yet checked" count under the class list falls as you edit each
     seeded label.
7. **Score** tab (with the run from step 3/4 still ticked):
   - The table shows precision, recall, F1 and count error for each ticked run, scored against the
     zone(s) you labelled.
   - With "Colour boxes by result" on, boxes on the map turn green (correct), red (a false alarm)
     or amber and dashed (a missed machine).
   - **Next mistake** / **Previous mistake** (the chevron buttons) fly the map to each error in
     turn and name it below the buttons.
8. **Export**: click the Export button in the map panel, choose **Run scored against labels** with
   all three formats (GeoJSON, GeoPackage, CSV) ticked, and submit. A toast points at "Past exports"
   on the Export screen; open the Export screen and wait for the job to finish, then use the reveal
   button to open its folder.
   - Open the `.gpkg` in QGIS: the layers should land on the machines, in the map's own coordinate
     system, at the correct real-world positions. **This step has not been run by anyone on the
     development machine** — no QGIS or `ogrinfo` exists there, so the writer is verified only at
     the byte level by an automated test. This is the first time the file is opened by real GIS
     software, so look carefully rather than a quick glance.
   - Open the `.csv` in Excel: every box should have four corners in both the map's coordinate
     system and in lat/lon, plus a centre and size.
9. Import a plain TIFF with no coordinate information (or strip the georeferencing from a copy of
   one you already have). It should still view, detect, label and score normally; the Export dialog
   should offer only the CSV format (the GeoJSON/GeoPackage checkboxes disabled) and say why: "This
   map has no coordinates, so only the CSV with pixel positions can be exported."

Please note anywhere the app's behaviour, wording or timing differs from what is written above —
that is exactly the gap this walkthrough exists to catch.
