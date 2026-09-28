# Point clouds: operator walkthrough (C-G)

This is sub-project C's walkthrough. It folds in the steps of the C units' own walkthroughs (W1, M1, P1,
R1, L1, V1, B3) and corrects them against the merged code on `task/c-g`. IMC-X folds these lines into
the combined walkthrough and repeats them on the installed build.

**Dev mode today.** From the worktree root:

```powershell
# First run in a new -Work folder: creates the project, imports the cloud and the photos.
.\frontend\scripts\run-dev-cloud-acceptance.ps1 -Work D:\kestrel-acceptance\walk -Cloud D:\kestrel-acceptance\clouds-data\chimney.las -Photos "\\DanNas\Work Data\Inspections\Kuwait\Chemney Stack POC\I2 3D Modeling\RAW Data" -Mode hold
# Later runs reopen the same project (this is also "restart the app").
.\frontend\scripts\run-dev-cloud-acceptance.ps1 -Work D:\kestrel-acceptance\walk -Mode hold
```

Edge opens the app on the real backend and waits until you close the tab. Use a project with the
chimney cloud and, if you have one, a posed DJI flight over it.

## The workspace

1. Open the project's **Point clouds** tab. The 3D view fills the window below the top bar. The tool
   palette is top left, with the cloud panel beside it. The inspector (**Findings | Measurements**) is
   on the right. The axis gizmo and the Top/Front/Side/Iso buttons are bottom left, the E/N/Z readout
   is bottom centre and the site map is bottom right. With Reduce motion off, the panels slide in. The
   cloud panel has no horizontal scrollbar.
2. Hover each tool: a tooltip names it with its key (O, H, W, P, L, Z, U, Q, E, C, M, I). Press **L**:
   Distance lights up and the hint bar at the top reads "Click two points to measure a distance". Press
   **Esc** once to drop the picks, and again to go back to Orbit.
3. Cloud panel: open the picker (the chevron) and see every cloud with its status. **Details…** opens
   the details (CRS, map link, capture date, **Export LAZ**, Delete, and "Report views: n · size" once
   report views exist). **Import point cloud…** opens the import dialog. An importing cloud shows a
   centred card with its progress; a failed one shows its reason with Import again and Delete.
4. **Colour by** RGB, Elevation, Intensity, Class: each one really recolours the cloud (Elevation
   draws the ramp, with Lowest/Highest/Reset) and changes the legend. Switching back to RGB brings the
   photo colours back. A mode the cloud lacks is greyed with a reason (the chimney: "This cloud has no
   intensity or classification."). On a LiDAR cloud with classes, click a class chip on Class to hide
   that class.
5. Drag **Point size** and **Point budget** ("x.x M shown" follows). Switch **EDL shading** off and on:
   the dark edge outline goes and comes back. Settings → Appearance → Visual effects → Reduced also
   removes it without a reload.

## Views and navigation

6. Click Top, Front, Side and Iso, and an axis head of the gizmo; press **Alt+1..4**; press **F** to fit
   the whole cloud. The gizmo arrows turn with the camera.
7. Site map: it shows the linked ortho ("Ortho · date") or the cloud's own top view ("Cloud · top
   view"), with a cone for where the camera looks. Click it: the view moves to that spot at the same
   angle.
8. **O** orbit, **H** pan (left drag pans), hold **Space** to pan from any tool (release: back to the
   tool), **W** fly (mouse look; W A S D, Q E, Shift fast; **Esc** leaves and the palette shows Orbit
   again).
9. Click a point in Orbit: the readout shows E, N, Z, Spacing (orange when coarser than 10 cm) and the
   EPSG code. With a linked map, the map icon at its end opens the same spot on the map.

## Measuring

10. **P** Point, **L** Distance, **Z** Height: click, read the result in the hint bar and the 3D label,
    press **Enter** to save. The row appears under Measurements ("Distance n") and is selected.
11. **U** Verticality: two picks, **Enter**. Then switch the hint bar to **Rings**, pick 3 or more points
    round the base, press **N**, pick round the top, **Enter**: two circles and the axis, and the lean
    in degrees and mm/m. **Backspace** removes a pick.
12. **Q** Area: click the corners, then **Enter** (or click the first corner, or double-click). Switch
    **Surface / Plan**: the value changes. **Backspace** removes the last corner. **Enter** saves the
    row in m².
13. **E** Cross-section: click A, then B. The slab highlights and the profile panel shows
    "Preview · display points". Change the thickness: the preview follows. **Save** shows "Cutting the
    profile…", then "Full resolution · n points" when the job finishes (Jobs shows "Cross-section
    profile"). In the panel, click two points: **Save as distance** adds a distance row.
14. **C** Clipping box: the box appears (dashed outline on the site map) and the cloud outside it
    disappears. Click the cloud to move the box there; change width, depth, height and yaw; switch
    **Show inside** / **Highlight** in the hint bar; **Clear box** removes it. Picks outside the box
    find nothing. Another cloud keeps its own box.
15. Measurements tab: select a row (the view flies to it and draws its geometry), rename it, write a
    note, **Attach to finding…** ("No finding" detaches), **Refresh view**, **Copy all as CSV**,
    Delete. Deleting a cross-section whose job is still running stops the job.

## Findings

16. **M** (the tool is **Pin a finding**): click the structure. A dashed pin and a "New finding" card
    appear; Create stays disabled until you choose a type. The hint bar shows only the instruction
    while the card is open (Create and Cancel are on the card, not twice). Choose a type, set a
    severity, press **Enter**: the pin drops in its severity colour and the report view is saved behind
    it (the inspector's thumbnail). A second pin of the same type is a click and **Enter**.
17. Orbit behind the structure: pins on the far side dim after the view settles; pins on the near
    side stay bright. Hover a pin for "Severity · Type". In a clip box's show-inside the pin hides; in
    highlight it dims.
18. Select a pin: the callout opens beside it, never under the inspector. Press **1-9** to set its
    severity and **T** to change its type; **Del** deletes it after "Delete F-xxxx?". In the
    inspector: Position, Uncertainty, **Fly to**, **Move pin** (click a new spot, "Pin moved"; the
    report view is re-captured), **Refresh view** (captures the current camera), **Show on map**, and
    **Likely views** with **Attach**.
19. Findings tab menu → **Capture missing views**: the hint bar shows "Looking for missing views…",
    then "Saving views i / n" with a bar, then "Saved n report views". **Cancel** stops after the
    capture in flight ("Stopped after n of N report views"); running it again finishes the rest. If
    findings are deleted while it runs, the summary says so plainly (for example "No report views
    saved: N no longer there"). Leaving the workspace mid-run shows no toast and no error.
20. Open a finding's link (`/p/{project id}/clouds/{cloud id}?finding={finding id}`, or from the Findings tab): the
    workspace opens on its pin with the callout. This also works for a finding beyond the 500 pins
    the cloud loads: its pin and callout are shown. Another cloud's finding id goes to that finding's
    own cloud; a deleted finding says "This finding no longer exists".

## Cameras and photos

21. **Show camera positions**: frustum glyphs appear over the cloud ("n photos · m with angles";
    position-only photos draw as dots; "k photos without GPS" if any). Click a glyph: its photo, file
    name and time, **Open in Images**, **Look through** (**Esc** returns; scrolling, orbiting or a
    view button also ends it). If the frustums float or sink ("Camera heights look off; set a height
    offset"), use the **−** / **+** 1 m nudges or type an offset: the glyphs move at once and the
    value survives a reload. A cloud with no CRS: the switch is off with "Assign a CRS to place the
    drone photos".
22. **I** Photo link: click the structure. A toast reads "n photos saw this point · DJI_xxxx closest
    (d m)", and a list of thumbnails shows each photo's distance and method (**In frame** or **By
    distance**). Click one: Images opens the photo with the arrival ring on that spot and a **Back to
    3D** chip; Back to 3D returns to the cloud.
23. In Images, with a photo open and nothing selected, the image panel's **Open in 3D · (cloud name)**
    opens the cloud looking through that photo and lands on its centre spot. A photo without angles
    says "Camera angles unknown: showing where the drone was"; a spot off the cloud says "This spot is
    outside the cloud".
24. Close the tab and start the launcher again with the same `-Work` (the restart): the pins, the
    measurements and the report views are all still there.
25. Details… → Delete on a cloud that has findings: it asks "Delete the cloud and its N findings?";
    **Keep them** cancels; confirming removes both. While a cross-section job runs on the cloud, the
    delete is refused until the job finishes.

## Pending operator checks (C-G acceptance, `docs/evidence/clouds/README.md`)

These §16 rows are **pending operator**: an agent run cannot make the eye checks or the hand
measurements. Record the results in `docs/evidence/clouds/README.md` and `docs/progress.md`.

26. **Criterion 4, chimney row, and criterion 5, hand thickness.** Run:

    ```powershell
    .\frontend\scripts\run-dev-cloud-acceptance.ps1 -Work D:\kestrel-acceptance\clouds -Mode hold
    Copy-Item D:\kestrel-acceptance\clouds\out\hold-full.json docs\evidence\clouds\hand-measurements.json
    ```

    In Edge: measure the stack's lean with Verticality in Points mode; again in Rings mode (8 picks per
    ring, **N**, **Enter**) at the same two heights; then measure the shell thickness at the rim with
    two Distance picks (outer edge, inner edge). Close the tab. Record both lean results (criterion 4:
    "both methods are recorded"), and the hand thickness against the app's top band, **0.301 m**
    (criterion 5 passes within 2 cm).

27. **Criterion 7, photo link by eye.** Open each `docs/evidence/clouds/photolink/photolink-N-image.jpg`
    (N = 1 to 10) beside its `photolink-N.jpg`: does the ring contain the picked feature, and is any listed
    photo from the far side of the stack? Fill the table in `docs/evidence/clouds/photo-link.md`.

28. **Criterion 8, image to cloud by hand.** Follow `docs/evidence/clouds/photo-link.md` → "Operator
    run": pick 5 features with the Point tool, note their E/N/Z; find each in a photo and note the
    image id and pixel; write `D:\kestrel-acceptance\clouds\image-px.json`; then:

    ```powershell
    $env:KESTREL_IMAGE_PX = Get-Content D:\kestrel-acceptance\clouds\image-px.json -Raw
    .\frontend\scripts\run-dev-cloud-acceptance.ps1 -Work D:\kestrel-acceptance\clouds -Mode image2cloud
    Copy-Item D:\kestrel-acceptance\clouds\out\image2cloud-* docs\evidence\clouds\photolink\
    ```

    A row passes when the arrival pick is within 1.0 m of the hand-picked point.
