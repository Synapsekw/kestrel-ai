---
type: walkthrough
date: 2026-09-24
tags: [usability, surfaces, design]
related: ["[[2026-09-23-design-surfaces-design]]"]
---

# How to test: import a design surface

You need a detection project with the chimney cloud imported (Point clouds) and a surface built from
it (Volumes → Build surface). Generate the test designs once, from `backend\` in a terminal:
`.venv\Scripts\python.exe scripts\design_acceptance.py --dsm "<project>\surfaces\<surface id>\surface.tif" --out D:\designs\chimney`.
It takes about 40 s and prints the six files it wrote.

1. Open **Volumes**. Next to "Build surface", click **Import design surface**. (On a project with no
   surface yet, the same button sits next to "Build surface" in the empty state — you can import a
   design before any cloud surface exists; the preview then has no target to compare against.)
2. Type `D:\designs\chimney\site-nez.xml` in "Design file" and click **Read file**. A progress bar
   shows "Reading design file", then the Contents section lists the surface "Design" with its counts.
3. Check Placement: the target is your chimney surface, the Source CRS reads `EPSG:32639` with the hint
   "From the file: LandXML <CoordinateSystem epsgCode>", both units are Metre, and the switch hint says
   "LandXML stores northing first — already handled". Click **Preview**.
4. The preview image shows the grey hillshade of the cloud with the amber design over it. "Design on the
   cloud surface" is at least 95 %, and the median height difference is within ±0.2 m.
5. Click **Import surface**. The dialog closes, the new surface appears in the list as building and
   then ready, with a "Design" tag.
6. Import `site-enz.xml` the same way. The preview says the design and the cloud surface don't overlap
   and suggests "With easting/northing swapped, … % of the design lies on the cloud surface". Click
   **Apply**: a new preview runs and the overlap is back above 95 %.
7. Import `site-3dface.dxf`: one layer, DESIGN_TIN, selected, "3D faces" in the counts. The Source CRS
   is the cloud surface's, with a note that the file names no CRS — confirm it. Preview and import it.
8. Import `site-contours.dxf` (reading it takes about 40 s): one layer, CONTOURS. The Placement section
   now shows "Maximum edge length (m)" with "automatic". The preview lists "… long triangles were
   trimmed from the edges" and the image shows the notches of the hull trimmed. Import it.
9. Import `site-dem-32638.tif`: the Source CRS reads `EPSG:32638` "From the file: GeoTIFF CRS". The
   preview lands on the chimney surface; import it (the design is re-gridded onto the surface's grid).
10. Pick any file and change "Horizontal units" to "International foot (0.3048 m)": the Preview button
    shows "Preview out of date"; the preview then warns that the other foot moves the design by up to
    … m and offers "Read in Metre …". Close the dialog with **Cancel** — nothing is imported.
11. Type the path of a `.dwg` file: "Read file" answers under the field with "DWG files can't be read …
    save it as DXF".
12. A preview with a warning (for example `site-enz.xml` previewed without Apply) keeps "Import
    surface" disabled until you tick **Import despite these warnings**; tick it and the import starts.
    Delete that surface afterwards if you don't want it (see step 14).
13. For each imported design, start a **New measurement** over the chimney base with base "Another
    surface" set to that design and **Calculate**: every one runs and reports cut and fill.
14. Deleting a design surface: a design whose build **failed** shows **Delete** under its row in the
    surface list — click it and the row goes. A ready surface has no Delete button on the Volumes
    screen (S2's list offers Delete on failed rows only); a surface used by a measurement can't be
    deleted at all until those measurements are deleted.
