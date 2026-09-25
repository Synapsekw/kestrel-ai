---
type: walkthrough
date: 2026-09-24
tags: [usability, volumes]
---

# Volumes — how to test this

You need a detection project with the chimney point cloud imported (Point clouds screen) and, for
masking, its orthomosaic imported as a map source with a finished detection run. **Steps that need a
real cloud in the app wait on S1's point-cloud import landing on `main`.** Until then, opening
Volumes in a project with no ready point cloud shows the empty state "Import a point cloud first"
with a **Go to Point clouds** button; the acceptance numbers this walkthrough would produce were
instead measured module-level (calling the surface build and the volumes engine directly, with no
app) and are recorded in `docs/evidence/volumes-acceptance.md`.

1. Open **Volumes** in the sidebar. With no surface yet you see "Build a surface from a point
   cloud". Press **Build surface**, keep the defaults (Median — recommended, Auto cell size, fill
   gaps up to 1 m) and press **Build**. The surface appears in the list with a progress bar
   ("reading points …", "gridding block …", "filling gaps …", "building zoom levels").
2. When it is ready, the hillshade shows in the middle. Hover it: the bottom bar shows E, N, the
   EPSG code and Z. If the cloud is linked to its ortho, the **Ortho** switch puts the photo under
   a faint hillshade.
3. Press **P** or the toolbar's **Measure** button (labelled "Measure P" in the toolbar), click
   around a mound and double-click to finish. A measurement "Pile 1" appears and calculates
   automatically. Its **Results** tab shows "Stockpile volume (above base)", "Below base", Net,
   "± … m³ (indicative)", the areas and the base fit. (If no measurement is selected yet, the left
   column's **New** button — tooltip "New measurement (P)" — starts one the same way.)
4. On **Measure**, change **Base** to **Flat level** and press **Pick on map**, then click bare
   ground next to the mound. The measurement turns **Stale** with "Inputs changed: base changed —
   Recalculate". Press **Recalculate**.
5. Tick the detection run under **Machines and exclusions** (grouped "Same flight as top"). The
   machine footprints appear in amber; recalculate: the Results show a patched (machines) area.
6. Press **X** or the toolbar's **Exclude** button and draw around a container on the pile; set its
   mode to **Exclude**; recalculate: the Excluded area grows and the polygon area drops by the same
   amount.
7. Build a second surface from the +0.100 m copy of the cloud and select it. Draw a polygon on it,
   choose **Another surface** as the base and the original surface as the base surface, press
   **S** or the toolbar's **Stable** button and draw a stable area on ground that did not change.
   Calculate: the Alignment box says the surveys differ by +0.100 m and suggests the shift. Switch
   on **Correct vertical shift** and recalculate: net is within ± U of zero.
8. **Results → Export…**: tick all four formats and export. The toast reads "Export started: the
   files land in the project's exports folder when it is done." The files land in the project's
   **`exports/<stamp>/`** folder — **not** the Export screen's Past exports list, which does not
   list volume exports (Task 16's ruling P10: F0's export lists were not S2's to edit). The folder
   holds `volumes-report.pdf`, `volumes.gpkg`, `<name>-cutfill.tif` + `.qml`, `volumes.csv`,
   `volumes.xlsx` and `summary.json`. Open the GPKG and the TIF in QGIS: both in EPSG:32639, the
   polygon on the mound, the cut/fill ramp red/blue.
9. **View in 3D** opens the point cloud at the polygon.

## The toolbar's five tools

The toolbar shows short labels that fit next to both side panels at a 1280 px window: **Pan V**,
**Measure P**, **Stable S**, **Exclude X**, **Edit E** (the full name and the hotkey are the button's
tooltip and accessible name — e.g. "Draw measurement (P)"). Esc returns to Pan; Delete removes the
selected exclusion. Stable, Exclude and Edit are disabled until a measurement exists.

## What still needs the operator, and why

- **A real cloud in the app** (steps 1–9 above, as driven through the UI): waits on S1's
  point-cloud import screen landing on `main`. The module-level equivalent of steps 1, and the
  mound/base/±0.100 m parts of steps 3–7, is recorded in `docs/evidence/volumes-acceptance.md`.
- **The CloudCompare cross-check** (spec §7.3): CloudCompare is not installed on the build machine;
  see `docs/evidence/volumes-crosscheck.md`.
- **The QGIS / PDF / XLSX review** of an export folder: needs a real cloud in the app first.
