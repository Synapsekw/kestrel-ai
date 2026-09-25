---
type: walkthrough
date: 2026-09-26
tags: [usability, point-clouds]
---

# Point clouds — how to test this

Install the build from `frontend/src-tauri/target/release/bundle/inno/Kestrel AI_0.1.0_x64-setup.exe`
(or your own `pnpm -C frontend build:installer`). The acceptance session built this installer but did
**not** install or run it. Steps 7 and 8 below are the parts of spec §17.12 and §17.13 that were
not measured automatically. Please do them and send the screenshots.

The chimney LAS is on the NAS:
`\\DanNas\Work Data\Inspections\Kuwait\Chemney Stack POC\I2 3D Modeling\Chimney stack 3D\Chimney stack 3D\2_densification\point_cloud\Chimney stack 3D_group1_densified_point_cloud.las`.
A synthetic orthomosaic of it is at `D:\kestrel-acceptance\chimney-ortho.tif` (5 cm, EPSG:32639),
and the 3 × 3 tiled cloud (195 M points) is at
`C:\Users\D\AppData\Local\Temp\claude\E--Dev-Yolo-app\94a62452-00f9-4a20-ac7d-ca08e57e33c2\scratchpad\spike-data\big\big9.las`.

1. Open a detection project and choose **Point clouds** in the rail (below Site areas).
2. Choose **Import**, then **Browse** to the chimney LAS on the NAS. The dialog shows 21.7 M points,
   EPSG:32639 and no refusal. Name the cloud and choose **Import**. The row shows a progress bar
   ("copying …", "scanning …", "building the 3D view copy: INDEXING …") and turns **ready**. Details
   says "header bounds repaired". (The acceptance run took 20 s from the NAS and 9.5 s from a local
   SSD. See `docs/progress.md`.)
3. The cloud opens in 3D, in true colours, within a second or two. Drag to orbit, right-drag to pan,
   use the wheel to zoom towards the cursor, and double-click to retarget. **F** fits the view and
   **T** looks from the top.
4. In **View**, switch the budget to 8 M and back. Switch to Elevation and move the range. RGB is
   greyed out on a cloud without colour.
5. **Measure** → Vertical check: click the base of the stack, then its top. Read the offset, lean,
   direction (from grid north), mm/m and the ± uncertainty, then **Save**. Zoom in close and repeat:
   the ± shrinks. If a pick's ± is over 0.10 m, its precision line is in the warn (amber) tone. Take
   a screenshot of that and save it as `uncertainty-warn.png`. Also try the rim of the stack from
   close up (under 30 m). The automated run could not pick the rim: the view landed at the bottom
   of the flue. Note whether the app picks the rim, and what ± it shows. Try a pair only 0.3 m apart
   vertically: it is refused with "pick points further apart vertically".
6. **Copy all as CSV** and paste it into a spreadsheet.
7. Map ↔ 3D:
   1. Import `D:\kestrel-acceptance\chimney-ortho.tif` as a map.
   2. On the cloud's **Details**, link the ortho. It ranks first ("likely same flight" only if both
      dates match).
   3. On the map, right-click a recognisable pixel of the stack → **Open this spot in 3D**. The
      viewer opens at that spot with a pin and settles on the stack's surface, not below it. Take a
      screenshot and save it as `jump-3d.png`.
   4. Note the URL's `at=` and the map readout's pixel. `at` should equal the geotransform applied
      to the pixel, within 0.01 m.
   5. Pick a point → **Show on map**. The marker sits within 1 map pixel of the pick. Take a
      screenshot and save it as `jump-map.png`.
   6. A detection's **Open in 3D** also lands on the same spot with a pin.
8. **Export LAZ** from Details. The toast's **Show folder** opens the export. In QGIS (Layer → Add
   Point Cloud Layer), open the LAZ: it lands on the stack in EPSG:32639. Take a screenshot and save
   it as `qgis.png`.
9. Import the 3 × 3 cloud a second time and cancel it from **Jobs**. No `PotreeConverter.exe`
   remains in Task Manager, and the cloud says "import cancelled".
10. **App settings → About Kestrel AI** lists nine components with their licence texts.
