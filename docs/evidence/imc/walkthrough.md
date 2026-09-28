# I/M/C wave: operator walkthrough (installed build)

One run through the installed app after the Images, Maps and Point clouds wave (I, M and C units,
merged in IMC-X). You need a project with a DJI flight (photos with GPS and camera data), two
GeoTIFF orthomosaics of different dates (for example Aug and Sep) with a DSM for each, a design
(bare-ground) DTM, a LAS/LAZ point cloud linked to the later ortho, a detection model that maps a
class to a defect type, and optionally a multi-page PDF plan and a DXF site plan. The smart polygon
tool needs the SAM weights at `E:\Dev\Yolo\models\sam2.1_t.pt`; if the app cannot find them it offers
"Get smart polygon model (≈78 MB)" and downloads them as a job.

A few steps open an address directly (`/p/<project>/…`), as an old bookmark or link would. Steps
84–86 use the dev acceptance launcher, not the installed app; they are the pending C-G checks.

## Part A — Images

1. Open a project, **Add data → Photos**, and choose a DJI flight folder.
   Expect: the import runs as a job; the UI stays usable.
2. Click the **Images** tab.
   Expect: the first frame opens. The three panes rise once. The status bar reads
   "Image 1 / N · Reviewed … · Saved". A one-time toast says the keys changed.
3. Press **→** and **←**, then **Shift+M**.
   Expect: the frame changes without the panes replaying. **Shift+M** flips between Grid and Map; the
   Map shows the capture points and the current frame's footprint. The info chip shows
   "GSD … mm/px" (or "GSD —" and "Set distance…" for a non-DJI camera).
4. With nothing selected, look at the inspector. Type 12 in **Subject distance** and press Enter, then
   clear it.
   Expect: the inspector shows camera, distance with its source and ±, GSD and footprint. The info
   chip's GSD changes; clearing restores the automatic value.
5. Press **T**, pick Crack, press **B** and drag a box. Press **3**.
   Expect: the inspector shows the new finding; **3** makes it Major.
6. Draw a rotated box (**R**, three points), a polygon (**P**, clicks, Enter) and a point (**M**).
   Press **Ctrl+Z**, then **Ctrl+Y**.
   Expect: the status bar says what each tool expects. **Ctrl+Z** removes the point; **Ctrl+Y**
   brings it back.
7. Reload the window, then open the **Findings** tab.
   Expect: all four shapes are still there, and the Findings tab lists them.
8. Back in Images, select the defect box. Click **Show on image**. Look at "Findings on this image"
   and click a row.
   Expect: the finding inspector shows Measured size in mm ± and "from GSD … at … m (nadir approx.)".
   Show on image pans to it. The list shows findings, then objects; a row click selects and pans. On a
   frame with no distance, Measured size shows px and "Set distance…".
9. Press **V**, click the box and drag the rotate handle with **Shift** held. Drag the body. Press
   **Alt+Shift+→**, then **Alt+→**.
   Expect: the rotation snaps every 15°. The box moves; **Alt+Shift+→** moves it 10 px, **Alt+→** 1 px.
10. Select the polygon. Drag a corner handle, **Alt+click** an edge, then **Alt+click** points until
    three are left and try once more.
    Expect: the corner moves; Alt+click on an edge adds a point, on a point removes it. At three points
    a toast refuses: "A polygon needs at least 3 points."
11. Press **Esc**, press **B**, then **T** with nothing selected. Press **M**, then **B** again.
    Expect: "Choose a type" opens at the cursor. With **M** the chip switches to a defect type and
    **T** offers defect types only. Back on **B** the chip shows the type you last used there (it is
    remembered per tool).
12. Add a note to a finding in the inspector. Select its shape and press **Del**. Click **Keep**; press
    **Del** again and click **Delete**; then press **Ctrl+Z**.
    Expect: "Delete this shape? F-… has a note, photos or comments…". Keep keeps it; Delete removes it;
    Ctrl+Z brings the shape back (not the finding's note, photos or comments).
13. Select a Crack shape, press **T** and choose an object type (for example Truck).
    Expect: "Change to an object type?" names the finding that would be deleted. **Keep the finding**
    leaves it a Crack.
14. Draw a new defect shape, add a note to its finding in the inspector, then press **Ctrl+Z**.
    Expect: the undo refuses with "This finding has a note or photos; delete it from the inspector.";
    the undo stays available.
15. Tab to a palette button and press **Space**; then click the canvas and hold **Space**.
    Expect: the button is pressed and the canvas does not pan; on the canvas, Space pans.
16. Scroll to zoom past about 51 %. Press **0**, **Shift+H** and **G**.
    Expect: the frame sharpens past 51 %. **0** fits; **Shift+H** hides the annotations; **G** toggles
    suggestions.
17. Press **L** and click twice across a crack.
    Expect: the length reads "… mm ± …" with its distance source.
18. Press **D**, choose a library model, press **D** again.
    Expect: suggestions appear with a hint bar; the toast reads "<Model>: N new, M already covered".
19. Press **A** on a suggestion, **3**, then **X** on another and **Tab**. Press **Ctrl+Z** after an
    accept.
    Expect: **A** accepts it and opens it as a finding; **3** grades it; **X** rejects; **Tab** jumps
    to the next image with suggestions. **Ctrl+Z** after an accept puts the suggestion back.
20. Press **]**. Close and reopen the project.
    Expect: weak suggestions hide and the hint bar says how many are hidden; the threshold is kept
    after reopening.
21. Press **S** (if asked, "Get smart polygon model"). Click a spall, **Shift+click** to exclude an
    area, press **Enter**. Try a click on empty ground, and **Esc** twice.
    Expect: a polygon appears. Empty ground says "Nothing found here, try another point". The first Esc
    clears the points, the second deselects. The model download, if needed, shows in Jobs.
22. Start a training run, then use **D** and **S** again.
    Expect: both still work; the D toast adds "· ran on CPU", and S is marked CPU.
23. Open `…/images?batch=1` (or `/query` from an old bookmark) and start "Detect on many images".
    Expect: a run is queued; when it ends the toast offers "Review suggestions →".
24. Run detection over a photo source with an OBB or a segmentation model, then over a map source.
    Expect: the photo run produces detections; the map-source run is refused.
25. Open `/review`, `/label` and `/edit/<imageId>` from old bookmarks, and More → Review. Under the
    Unlabeled filter, press **N**.
    Expect: `/review` shows Images filtered to suggestions, `/label` unlabeled images, `/edit/<id>` that
    image; More → Review shows the detection runs picker. **N** keeps the frame open with no "deleted"
    toast.
26. Draw a box or review a suggestion, then look at the image list.
    Expect: that image's box and pending counts change at once. Point markers do not count as labels.
    Opening an existing labelled project started no summary rebuild job.
27. Narrow the window below 1100 px, then below 960 px.
    Expect: below 1100 px the inspector hides (**Ctrl+]** shows it); below 960 px **Ctrl+[** shows the
    browser.
28. On a large flight, scroll the grid top to bottom and use **←/→**. If you have a flight of about
    20,000 frames, press **Shift+M** and drag-pan and zoom the capture map.
    Expect: the grid and the frame changes stay smooth. The capture map stays responsive (see Checks 3).
29. Models → Datasets → New dataset: pick the project and Crack, Task = Polygons. Tick "Boxes as
    polygons" and create it. Library → Starters: family "YOLO11-seg", nano, Add. Models → Training →
    New run with the polygon dataset, 1 epoch.
    Expect: the preview says how many images are skipped (boxes or point markers); "Boxes as polygons"
    removes that line. Only segmentation models are listed for the run. Progress shows "Mask mAP50";
    the finished model lists Mask mAP50 and Mask mAP50-95, task "Polygons".
30. Project → Results → Export, tick YOLO-seg polygon labels.
    Expect: the export holds `labels_yolo_seg\<site>\*.txt`; COCO polygons carry `segmentation`.

## Part B — Maps

31. Click the **Maps** tab. Hover the palette.
    Expect: the workspace fills the window: tool palette top left with the Layers panel beside it,
    coordinates bottom left, zoom and north bottom right. Both orthos line up. Tooltips read
    "Select V", "Pan H".
32. In Layers, look at Base maps and Elevation. Open a map row's **⋯** and a DSM row's **⋯**. Show the
    September DSM; switch Hillshade / Tint / Contours; type interval 0.5 and press Enter.
    Expect: Base maps lists the newest survey first; DSMs are hidden by default. The map row menu offers
    Set survey date, Run AI on the whole map and Delete map; a DSM row offers Set date and role. The
    hillshade lines up with the orthos; contours every 0.5 m.
33. Move the pointer over the DSM, off the site, and hide the DSM. Click the CRS chip.
    Expect: E/N and a teal **Z** with a real value (for example "Z 612.34 m"); off the site "Z —";
    with the DSM hidden Z disappears. The CRS chip toggles lat/lon.
34. Choose **Swipe** and drag the round handle (arrow keys; Shift = 10 %). Press **C** three times.
    Expect: the earlier date is left of the line, the later right. **C**: Side-by-side folds the
    Layers panel away, labels each side and shows a ghost crosshair on the other half. **C**: Blend,
    whose slider fades between the dates. **C**: back to Single and the Layers panel returns.
35. Press **]** and **[**, then **P**. Click a timeline tick. Pan to where one date has no imagery. Drag
    in the minimap.
    Expect: the right date steps through the surveys and P plays through them; the R marker moves; a
    tick jumps to its date; planned dates cannot be selected. That side reads "No 14 Aug data here"
    (with your date). The map follows the minimap drag at once, with no trailing animation.
36. Reload the window.
    Expect: the compare mode, the dates and the view come back.
37. Layers → **Add a layer** → **Import drawing**. Pick the multi-page PDF, **Read file**, choose page 2
    at 300 dpi, **Start import**.
    Expect: Add data opens directly on the drawing import (the Drawings group's **+ Import** does the
    same). Page thumbnails appear; a very large page shows "renders at … dpi". A toast says the import
    runs in the background.
38. Import drawing again with the DXF. Choose **Coordinates (EPSG)**, enter the site EPSG code,
    **Start import**. Click a piece of its linework. Untick a layer in the inspector.
    Expect: the dialog lists the layers (empty ones greyed), the CRS marked unverified and the units.
    The plan lands in place over the orthos. Clicking linework selects the drawing (see Checks 2).
    The unticked layer vanishes without a reload.
39. Add data → Elevation → **DSM / DTM GeoTIFF**: pick a DSM, role DSM, leave the date blank, **Start
    import**. Then try an RGB ortho, and a file that does not overlap the site.
    Expect: the import runs under Jobs with progress, the UI stays usable, and the DSM appears under
    Elevation dated from the file. The ortho is refused inline ("this is an image (an orthomosaic?),
    not a height model — import it under Maps"); the non-overlapping file is refused inline too. The
    dialog stays open and no job starts.
40. The PDF is under Drawings as "not placed". Open its row menu **⋯** → **Align**. Click a corner on
    the plan, then the same corner on the ortho; repeat for four corners.
    Expect: the align session starts at once (plan at 60 % of the view, half transparent; a disabled
    **Save placement**). Bubble 1 and a dashed line appear; the plan snaps after the second pair; the
    table lists four pairs with residuals and the RMSE (with two pairs: "Add a point to check the fit").
41. Switch Model to Affine and back. Press **Backspace**, re-pick the pair, then **Save placement** (or
    Enter). Then row menu → **Knock out white**.
    Expect: a toast shows the RMSE, the plan stays at full opacity, its row reads
    "4 control pts · RMSE …", and the tool returns to Select. Knock out white removes the paper
    background. (Clear placement in the inspector, confirmed, returns it to "not placed".)
42. Press **L**, click three points along a haul road and double-click. Rename it "Haul road", click
    away, and click the line with **V**.
    Expect: a live "≈ … m grid" label follows the cursor. The inspector shows the ground distance, the
    grid distance and scale factor, and a 3D length. The name is kept.
43. Press **Q** and outline a yard. Then select a measurement and press **Del**.
    Expect: area, perimeter, grid area and scale factor. "Delete this measurement?" with "This cannot
    be undone."
44. In Swipe, press **E** and draw a line across the pit. Hover the chart, then the line. Click
    **Expand**, then **Escape**. Tick the design surface under Surfaces. Draw a profile outside every
    DSM.
    Expect: a profile chart of both DSMs with cut and fill between them. Chart hover moves a marker on
    the line and line hover moves the chart cursor. Escape closes the wide sheet. A third line appears
    for the design. Outside every DSM: "No elevation under this line".
45. With September on the right, press **U**. Outline a stockpile and double-click.
    Expect: the hint reads "Volume · Click to add vertices · double-click to close · Esc cancels" (on a
    date with no DSM the tool is disabled with "No DSM for <date> — import one or build it from a point
    cloud"). The inspector shows a progress line, then net, cut and fill; the blue/red cut/fill heatmap
    shows inside the polygon.
46. Switch the base between **Lowest point**, **Best-fit plane**, **Design DTM** and **Earlier survey**.
    Toggle **Cut / fill heatmap** off and on.
    Expect: each time the numbers dim and new ones arrive; the earlier-survey base card names its date.
    In a project without designs, Design DTM is disabled with "No design surface — import one from Add
    data".
47. Type Material "Gravel" and Density 1.8. Turn off "Recalculate automatically" and change the base.
    Drag a vertex. Open "Masks & alignment" → Draw exclusion and draw a polygon. Click **Export CSV**.
    Press **Del**.
    Expect: Tonnage shows net × 1.8 with no recalculation. The volume goes Stale with a Recalculate
    button. A vertex drag saves and recalculates. An exclusion row appears. Export CSV runs under Jobs;
    the file ends with material, density_t_m3 and tonnage_t. Del asks "Delete this volume
    measurement?".
48. Press **M**, click a crack on the September ortho, press the crack type's hotkey. Press **G** and
    outline spalling. Hover the first pin. Hide the September ortho and press **M** again.
    Expect: a pin drops with one ring pulse, the finding inspector opens and "Measured size" shows the
    height. The spalling outline fills in its severity colour with "≈ … m² grid". The tooltip reads e.g.
    "F-0031 · Manual + open". With no ortho: "Findings need an orthomosaic under them", nothing is
    created.
49. In the Findings row, turn on **All surveys**, untick **Closed**, set **Severity at least** to Major.
    Expect: the map follows; the row's first line counts what is in view.
50. Press **Z**, outline an area, name it "Crane exclusion", choose **Exclusion**, Save. Open **Site
    areas** (More menu) and click **Draw an area**. Delete the zone.
    Expect: the zone is hatched with its name in capitals; a toast says counts update in the
    background; the zone inspector lists objects per survey. Site areas lists it; Draw an area opens
    the workspace with the zone tool armed. Delete asks "Delete this zone?" with "Object counts update
    in the background."
51. Look at the **AI detections** row. Click a pending defect.
    Expect: the row is on by default. Pending defects are violet dashed boxes; machinery class-coloured
    boxes with "Name 0.96" tags when zoomed in. The inspector shows type, confidence, model and
    "Ortho · 14 Sep 2026"; the hint reads "Reviewing · A accept · X reject · Tab next".
52. Press **A**, then **3**. Open the **Findings** tab.
    Expect: a finding pin drops with one ring pulse and its inspector opens; 3 sets its severity. The
    Findings tab lists it as "AI + reviewed" on that map.
53. Press **Tab**, then **X**. Tick "Accepted defects (findings)", select the defect from step 52 and
    press **X**; click "Keep it"; press **X** again and click "Delete finding".
    Expect: Tab pans to the next pending detection; X rejects it and selects the next. "Delete
    finding?" appears; Keep it changes nothing; Delete finding deletes the finding and the detection
    stays rejected.
54. From **Review**, choose a map run and click **Review on the map**. Press **Tab**, **A**, **X**.
    Expect: the workspace opens on that map with the run selected; Tab starts at the first detection.
    For a map without coordinates, it opens the evaluation screen instead.
55. Press **D** and drag a box over the ortho; **Run**. Then drag a box outside every ortho and Run.
    Expect: the inspector offers the last-used model and 0.25; a dashed outline and progress, then the
    region's detections, and the run shows "Region". The survey counts on the timeline and in Analytics
    do not change. Outside every ortho: "Nothing to scan in this box…", no job.
56. Delete a map from its row menu; delete a shown map from another screen. Open a project with one
    survey, one with no georeferenced data, and one in local metres.
    Expect: row-menu delete leaves with no toast; from another screen, one toast and the layer leaves.
    One survey: Swipe/Side/Blend greyed "One survey so far", Play disabled. No data: "No georeferenced
    data yet" with three imports. Local metres: M, G and Z disabled with reasons, the Findings and Zones
    rows say "Unavailable in local metres", a distance shows "Local metres, on the grid", and the
    coordinates row offers "Local metres · N surfaces" when both kinds exist.
57. Turn on **Settings → Appearance → Reduce motion**, then choose **Reduced** effects.
    Expect: panel entrances, the pill slide and the pin pulse stop animating. Under Reduced effects the
    floating panels lose their blur.
58. Real data: import your own DSM GeoTIFF of a flight that also has a point cloud; build that cloud's
    DSM; hover the same spots with each shown.
    Expect: the two **Z** values agree within about 2 cm.
59. Real data: place your real DXF by its CRS.
    Expect: its lines sit on the visible kerbs and edges within 10 cm.
60. Real data: import a scanned PDF plan and align it with four control points.
    Expect: the RMSE shows and the plan sits on the ortho.

## Part C — Point clouds

61. Open the **Point clouds** tab.
    Expect: the 3D view fills the window below the top bar. Tool palette top left with the cloud panel
    beside it; inspector (**Findings | Measurements**) on the right; gizmo and Top/Front/Side/Iso
    bottom left; E/N/Z readout bottom centre; site map bottom right. With Reduce motion off the panels
    slide in. The cloud panel has no horizontal scrollbar.
62. Hover each tool. Press **L**, then **Esc** twice.
    Expect: tooltips name each tool with its key (O, H, W, P, L, Z, U, Q, E, C, M, I). L lights
    Distance and the hint bar reads "Click two points to measure a distance". The first Esc drops the
    picks, the second returns to Orbit.
63. Open the picker (the chevron). Open **Details…**, then **Import point cloud…**.
    Expect: every cloud with its status. Details shows CRS, map link, capture date, **Export LAZ**,
    Delete, and "Report views: n · size" once report views exist. An importing cloud shows a centred
    card with progress; a failed one shows its reason with Import again and Delete.
64. **Colour by** RGB, Elevation, Intensity, Class, and back to RGB.
    Expect: each really recolours the cloud and changes the legend; Elevation draws the ramp with
    Lowest/Highest/Reset. A mode the cloud lacks is greyed ("This cloud has no intensity or
    classification."). On a LiDAR cloud, a class chip hides that class.
65. Drag **Point size** and **Point budget**. Switch **EDL shading** off and on. Then Settings →
    Appearance → Visual effects → Reduced, and Full.
    Expect: "x.x M shown" follows the budget. The dark edge outline goes and comes back, with no
    reload.
66. Click Top, Front, Side, Iso and a gizmo axis head; press **Alt+1..4** and **F**.
    Expect: the view tweens to each; the gizmo arrows turn with the camera; F fits the whole cloud.
67. Look at the site map and click on it.
    Expect: the linked ortho ("Ortho · date") or the cloud's top view ("Cloud · top view"), with a cone
    for the camera. A click moves the view there at the same angle.
68. **O** orbit, **H** pan, hold **Space** from any tool, **W** fly (W A S D, Q E, Shift fast), **Esc**.
    Expect: Space pans until released, then back to the tool. Esc leaves fly and the palette shows Orbit
    again.
69. Click a point in Orbit.
    Expect: the readout shows E, N, Z, Spacing (orange when coarser than 10 cm) and the EPSG code.
70. **P** Point, **L** Distance, **Z** Height: click, read, **Enter**.
    Expect: the result shows in the hint bar and a 3D label; Enter saves a row ("Distance n") under
    Measurements, selected.
71. **U** Verticality: two picks, **Enter**. Switch the hint bar to **Rings**: 3 or more picks round the
    base, **N**, picks round the top, **Enter**. Use **Backspace** once.
    Expect: two circles and the axis, the lean in degrees and mm/m; Backspace removes a pick.
72. **Q** Area: click the corners, then **Enter** (or click the first corner, or double-click). Switch
    **Surface / Plan**; use **Backspace**; **Enter**.
    Expect: the outline closes with a fill; the value changes with Surface/Plan; the row saves in m².
73. **E** Cross-section: click A, then B. Change the thickness. **Save**. In the panel, click two points
    and **Save as distance**.
    Expect: the slab highlights; "Preview · display points" follows the thickness. "Cutting the
    profile…", then "Full resolution · n points" (Jobs shows "Cross-section profile"). A distance row is
    added and the panel stays open.
74. **C** Clipping box: click the cloud, change width, depth, height and yaw, switch **Show inside** /
    **Highlight**, then **Clear box**. Switch to another cloud and back.
    Expect: a dashed outline on the site map; the cloud outside disappears; picks outside find nothing.
    Each cloud keeps its own box.
75. Measurements tab: select a row, rename, write a note, **Attach to finding…** (then "No finding"),
    **Refresh view**, **Copy all as CSV**, Delete. Delete a cross-section while its job is running.
    Expect: the view flies to the row and draws its geometry, even with a tool armed. The CSV has 46
    columns with `geometry_wkt` as POINT Z / LINESTRING Z / POLYGON Z. Deleting a running cross-section
    stops its job. On a cloud in degrees, distance, area and cross-section say "distances need a
    projected coordinate system; this cloud is in degrees".
76. Details… → **Export LAZ** with measurements; open the `…-measurements.csv`.
    Expect: the job runs in Jobs. The CSV ends with `vertex_count`, `geometry_wkt` and the area, ring and
    profile columns.
77. **M** (Pin a finding): click the structure. Choose a type, set a severity, press **Enter**. Click
    again and **Enter**.
    Expect: a dashed pin and a "New finding" card; Create stays disabled until a type is chosen; the
    hint bar shows only the instruction (Create and Cancel are on the card). The pin drops in its
    severity colour and pulses; the report view is saved (the inspector's thumbnail). The second click
    makes a second pin of the same type.
78. Orbit behind the structure; hover a pin; turn on the clip box in show-inside, then highlight.
    Expect: far-side pins dim after the view settles; near-side pins stay bright. Hover reads
    "Severity · Type". Show-inside hides the pin; highlight dims it.
79. Select a pin. Press **1-9**, **T**, then use **Fly to**, **Move pin**, **Refresh view** and **Likely
    views → Attach**. Press **Del**.
    Expect: the callout opens beside the pin, never under the inspector. The inspector shows Position
    and Uncertainty. Move pin: click a new spot, "Pin moved", the report view is re-captured (Esc during
    Move returns to Orbit). Del asks "Delete F-xxxx?".
80. Findings tab menu → **Capture missing views**. Run it again. Start a third run and press **Cancel**;
    start one more and leave the workspace.
    Expect: "Looking for missing views…", "Saving views i / n" with a bar, "Saved n report views". The
    second run says every finding and measurement has a current report view. Cancel: "Stopped after n
    of N report views". Leaving mid-run shows no toast and no error.
81. Switch on **Show camera positions**. Click a glyph; use **Look through**, then **Esc**. If heights
    look off, use **−** / **+** or type an offset.
    Expect: "n photos · m with angles"; frustums, or dots for position-only photos; "k photos without
    GPS" if any. The card shows the photo, file name, time, **Open in Images** and **Look through**.
    Esc (or scroll, orbit, a view button) ends the look-through. "Camera heights look off; set a height
    offset" when relevant; the glyphs move at once and the value survives a reload. A cloud with no CRS
    has the switch off with "Assign a CRS to place the drone photos".
82. Close the app and start it again; open the same cloud.
    Expect: the pins, the measurements and the report views are all still there.
83. Details… → Delete on a cloud that has findings; click **Keep them**; then confirm. Try it while a
    cross-section job is running.
    Expect: "Delete the cloud and its N findings?"; Keep them cancels; confirming removes both. While a
    cross-section job runs, the delete is refused until the job finishes.
84. Pending check, criteria 4 and 5 (source: clouds walkthrough step 26). From the repo root:

    ```powershell
    .\frontend\scripts\run-dev-cloud-acceptance.ps1 -Work D:\kestrel-acceptance\clouds -Mode hold
    Copy-Item D:\kestrel-acceptance\clouds\out\hold-full.json docs\evidence\clouds\hand-measurements.json
    ```

    In Edge, measure the stack's lean with Verticality in Points mode, and again in Rings mode (8 picks
    per ring, **N**, **Enter**) at the same two heights. Measure the shell thickness at the rim with two
    Distance picks (outer edge, inner edge). Close the tab.
    Expect: both lean results recorded (criterion 4); the hand thickness within 2 cm of the app's top
    band, **0.301 m** (criterion 5). Record in `docs/evidence/clouds/README.md` and `docs/progress.md`.
85. Pending check, criterion 7 (source step 27). Open each
    `docs/evidence/clouds/photolink/photolink-N-image.jpg` (N = 1 to 10) beside its `photolink-N.jpg`.
    Expect: the ring contains the picked feature, and no listed photo is from the far side of the stack.
    Fill the table in `docs/evidence/clouds/photo-link.md`.
86. Pending check, criterion 8 (source step 28). Follow `docs/evidence/clouds/photo-link.md` →
    "Operator run": pick 5 features with the Point tool and note their E/N/Z; find each in a photo and
    note the image id and pixel; write `D:\kestrel-acceptance\clouds\image-px.json`; then:

    ```powershell
    $env:KESTREL_IMAGE_PX = Get-Content D:\kestrel-acceptance\clouds\image-px.json -Raw
    .\frontend\scripts\run-dev-cloud-acceptance.ps1 -Work D:\kestrel-acceptance\clouds -Mode image2cloud
    Copy-Item D:\kestrel-acceptance\clouds\out\image2cloud-* docs\evidence\clouds\photolink\
    ```

    Expect: each row passes when the arrival pick is within 1.0 m of the hand-picked point.

## Part D — Cross-links

87. In the cloud, press **I** (Photo link) and click the structure. Click a photo in the list.
    Expect: a toast "n photos saw this point · DJI_xxxx closest (d m)" and a list of thumbnails, each
    with its distance and **In frame** or **By distance**. Images opens the photo with a dashed arrival
    ring on the spot and a **Back to 3D** chip; the address is cleaned.
88. Click **Back to 3D**. Do the photo link again; this time press **Esc** in Images, then **→**.
    Expect: Back to 3D returns to the cloud. Esc removes the ring; → drops the ring and the chip.
89. In Images, open a photo covered by the cloud, select nothing, and use Image actions →
    **Open in 3D · <cloud>**. Try a photo without angles, and a spot off the cloud.
    Expect: the cloud opens looking through that photo and lands on its centre spot. Without angles:
    "Camera angles unknown: showing where the drone was". Off the cloud: "This spot is outside the
    cloud".
90. In the cloud, click a point in Orbit and click the map icon at the end of the readout; then select a
    pin and click **Show on map**.
    Expect: the Maps workspace opens on the linked map (`maps?map=…&at=…`), centred on that spot, with
    no marker.
91. On the map, select a detection and click **Open in 3D**; then right-click the map and choose **Open
    this spot in 3D**.
    Expect: the cloud opens at that spot and draws the detection's footprint. On a map with no linked
    cloud the button is replaced by the reason, and the right-click item is greyed with a reason.
92. Findings tab: open an image finding; then open a map finding and click **Open in workspace** and
    "Show on other survey"; then open a map finding that was deleted.
    Expect: the image finding opens its image with the finding selected. The map finding is centred
    with its inspector open and the survey date in the map strip; "Show on other survey" switches the
    date. A deleted map finding: one toast and the site is fitted.
93. Open a 3D finding from the Findings tab (or `/p/<project>/clouds/<cloud>?finding=<id>`). Try
    another cloud's id in the link, a finding beyond the 500 pins the cloud loads, and a deleted
    finding.
    Expect: the workspace opens on its pin with the callout. Another cloud's id goes to the finding's
    own cloud. A finding beyond the 500 still shows its pin and callout. A deleted one says "This
    finding no longer exists".
94. Open the project's **Measurements** tab. Click **Maps** in the filter, pick **Area**, then **All**.
    Expect: a table of Name, Kind (e.g. "Map · Distance", "Volume"), Value (e.g. "1 234.5 m³"),
    Status, Updated, with map, volume and point-cloud measurements together. The address ends
    `?kind=map` under Maps.
95. Click a map row, a volume row (and its map icon), and a point-cloud row. Paste an old address
    `/p/<project>/measurements/<volume id>`.
    Expect: the map row opens the workspace with that measurement selected; the volume row opens the
    volume screen at `…/measurements/volumes/<id>`, and its map icon opens the workspace with that
    volume selected; the cloud row opens that cloud in 3D. The old address lands on the same volume.
96. Click **Surfaces and volumes**, then **New**. With the tab open, save a map distance in another
    window. Open a project with no measurements.
    Expect: the volume screen opens (surfaces, Build surface, Import design); New keeps you there with
    the draw tool armed. The new row appears within about 1 s with no empty flash. The empty project
    shows "No measurements yet" with **Open maps**.
97. Open old map bookmarks: `/p/<project>/maps/<map id>`, `…?mode=review&run=<run id>`,
    `…?draw=site-area`, and the same bookmark for a map without coordinates.
    Expect: the workspace opens on that map; the review link lands with the run selected; the draw link
    with the zone tool armed. A map without coordinates goes straight to its evaluation screen
    ("No coordinates in this file", with Results, Labels and Score); `run=`/`draw=` are dropped. Inside
    the workspace such a map is greyed with **Open in evaluation view**.

## Checks only you can do

1. **C-G pending operator checks.** Criterion 4 chimney row and criterion 5 hand check: step 84.
   Criterion 7 (photo link by eye): step 85. Criterion 8 (image to cloud by hand): step 86. Record the
   results in `docs/evidence/clouds/README.md` and `docs/progress.md`.
2. **M-X real-data checks.** M-X's acceptance ran on synthetic stand-ins, so these need your data:
   DSM import against the cloud's DSM (Z within about 2 cm, step 58), a real DXF placed by its CRS
   (within 10 cm, step 59), and a scanned PDF aligned by four points (step 60). Also confirm DXF
   linework click-to-select in the installed app (step 38); M-W5 left it untested and M-X only tried
   it in dev.
3. **I-E capture map at scale.** On the installed WebView2 build, open a capture map with about 20,000
   points (**Shift+M**) and drag-pan and zoom it (step 28). Headless tests on SwiftShader locked at
   10,000 points or more, so the pan was never measured. Note whether your real GPU also stutters; if
   it does, that is I-FB's clustering / level-of-detail work.
4. **Resized input fields.** C-G fixed the shared `ui/Input` and `ui/Slider` overflow; the fix changes
   every sized input and slider. Eyeball: Catalogue types, Sources survey date, Site areas rename, Map
   layers and drawings, and the cloud height offset (step 81).

## Operator-visible rulings

- Unpromoting a detection run is refused (409) while any of its findings has a note or photo. Remove
  the note or photo first. (I-BP)
- On a map, reclassing an accepted defect detection to a non-defect class removes its finding, after a
  confirmation. (M-B5)
- Opening an existing project runs no image-summary rebuild. Dev projects written during the wave may
  need `POST …/image-summary/rebuild` once. (I-BX)
- The segmentation GPU test skips until `yolo11n-seg.pt` is in `E:/Dev/Yolo/models`. The seg starter
  download URL is unverified, so step 29 may fail at the download. (I-BT)
- Perf gates allow 0.5 ms timer jitter (Images). The map frame budget is only enforced with
  `E2E_FRAME_BUDGET=1` (Maps).
- Point-cloud camera z is always metres. It is wrong on a cloud whose vertical unit is feet. (C-B3, spec
  follow-up)
- Retired by operator decision 2026-09-28: resuming an interrupted detection run (start it again) and
  bulk undo of accepted labels. There is no UI successor. The Setup agent's "Resume first labeling"
  still works.
- After a 3D → map jump there is no `at` marker; the map just centres. (M-X)
- Two quick clicks far apart can finish a map line early (OpenLayers' double-click window). (M-X)
- C-G criterion 4 azimuth is recorded FAIL by test design: the G7 noise level conflicts with ±0.5°. It
  is a spec follow-up, not a product bug.
- 3 of 5 `?finding=` arrival re-picks in 3D miss by about 0.44–0.69 m. (C-P1/C-L1 follow-up)
- Error messages for a missing image, drawing or map file show the local path you chose. This is kept on
  purpose: it is a single-user desktop app and the path helps you find the file. (IMC-X)
- Drawing a shape and then giving its finding a note or photos blocks undoing that drawing: Ctrl+Z
  refuses and points you to the inspector. Undoing a shape delete brings the shape back but not the
  finding's note, photos or comments. (I-FC)
- Point markers no longer count as labels in the image counts. (I-BX)
- A raster drawing (PDF, PNG) cannot be selected by clicking the map; use its Layers row menu. DXF
  linework can be clicked directly. (M-W5)
- A map without coordinates always opens its evaluation screen, from old bookmarks, the palette and
  "Review on the map"; a `run=` or `draw=` on the link is dropped. (M-X, I1)
- A region detection run (**D** on the map) never changes survey counts on the timeline or in
  Analytics. (M-B5)
- A bulk reject that would delete findings shows a message rather than the "Delete finding?" confirm.
  (M-W4)
- A quick double create can make two volumes; parked. (M-W4)
- Every `?map=` or `?finding=` arrival on the map switches the compare mode to Single. (M-W1)
- In a local-metres project, map findings (M, G) and zones (Z) are unavailable. (M-W3)
- A point cloud cannot be deleted while a cross-section job runs on it; deleting a cross-section whose
  job is running stops the job. (C-G)
- Report-view captures are drawn without the EDL edge outline (a potree-core 2.0.15 limit). (C-V1, C-G)
- At whole-cloud zoom, a far-side pin without a stored normal on a structure thinner than about 2–4 m
  may stay bright. Pins made with the pin tool carry a normal, so they still dim. (C-G)
- In Images, a filtered frame deleted after it loaded stays open, and the workspace has no
  import-started banner. (I-FW)
- The floating tool palette covers the left ~110 px of an image at fit scale; a UX fix is for later.
  (I-E hand-off, I-FC)

## Sources

- `.superpowers/sdd/imc-common/walkthroughs/`: `i-ba.md`, `i-bp.md`, `i-bs.md`, `i-bt.md`, `i-bx.md`,
  `i-e.md`, `i-fa.md`, `i-fb.md`, `i-fc-task-11-report.md`, `i-fw.md`; `m-b1.md` to `m-b5.md`,
  `m-w1.md` to `m-w6.md`, `m-w3-task-13-report.md`, `m-x-task-16-report.md` ("Walkthrough (final)");
  `c-b1-task-9-report.md`, `c-b2.md`, `c-b3.md`, `c-b4.md`, `c-g.md`, `c-l1.md`, `c-m1.md`,
  `c-p1.md`, `c-r1.md`, `c-v1.md`, `c-v2.md`, `c-w1.md`, `c-w1-task-12-brief.md`,
  `c-x1-task-8-report.md`
- `docs/evidence/images/README.md` (§5 operator walkthrough and unit lines, §6 findings)
- `docs/evidence/maps/README.md`
- `docs/evidence/clouds/walkthrough.md` (steps 1–28), `docs/evidence/clouds/README.md` (changes to
  other units' code, open items), `docs/evidence/clouds/photo-link.md` ("Operator run")
- `.superpowers/sdd/imc-common/handoffs.md` (sections "From I-E", "From M-X", "From C-G", "From I-FW",
  plus the operator-visible items in earlier unit sections)
