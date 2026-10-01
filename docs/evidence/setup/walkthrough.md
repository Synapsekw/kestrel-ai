# Project setup (S1): how to test this

One run through the whole of S1 (units U1 to U6): the new-project setup page, the sorting behind it,
templates, the Catalogue's type editor and the imports that start when you create a project. Use the
app built from `main` (the next installer, or `pnpm -C frontend tauri dev` in the main checkout).
Every expected text below was checked against the merged code. You need:

- a DJI M30T or H20T delivery folder whose photos folder holds both `_V` and `_T` JPEGs, plus a
  one-page PDF drawing somewhere under the same delivery folder;
- a multi-page PDF (any plan set);
- for steps 15, 33 and 37, an orthomosaic GeoTIFF and a DSM GeoTIFF in one folder;
- optionally a folder with a `.las`, a `.dwg`, an `.mp4` and a `Thumbs.db` (steps 12 and 13).

Screenshots of the automated runs are next to this file (`setup-sorted.png`,
`overview-after-create.png`, `setup-notice-failed.png`, and the `-real` pair from the real backend).

## The page and its templates

1. Open **Projects** and click **New project** (or press Ctrl+K and choose New project).
   Expect: a full page (not a dialog) at `/projects/new`, breadcrumb Projects / New project, with
   Template, Basics, Data and Anomalies cards and a "Ready to create" summary. Blank is chosen.
2. Choose **Vertical asset inspection**.
   Expect: the Data card shows Visual photos (required), Thermal photos, 3D point cloud and Asset
   drawings; the Anomalies card lists 7 types with hotkeys 1 to 7.
3. Edit Corrosion's severity, switch to **Mapping and survey** and choose **Keep mine and add the new
   ones**: 13 types. Switch back to Vertical and choose **Replace the anomaly list**: the 7 return.
4. Type a name and choose a new, empty project folder (field "Folder").
   Expect: the summary ticks Template and "Name and folder", and **Create project** is enabled.
5. Click **Save as my template**, give it a name.
   Expect: it appears among the templates. Its menu renames it (a taken name is refused inline) and
   deletes it after asking; the page falls back to Blank if it was the chosen one. The three built-ins
   have no menu.
6. Narrow the window below 1100 px.
   Expect: the summary becomes a bottom bar and the checklist opens in a popover.

## Sorting a delivery folder

7. Drop (or **Browse folders** to) the delivery folder on the Data card. In the browser, paste the path
   into "Folder or file path" and click **Sort files** instead.
   Expect: a progress bar while the files are sorted (Jobs shows a "Sorting files" job finishing in
   seconds; only 20 photos per folder are opened). Visual photos and Thermal photos each show a count
   and size, naming the same `DCIM\100MEDIA` folder; Asset drawings shows the PDF; and the note
   "Visual and thermal photos in the same folder are imported together." Files Kestrel does not know are
   listed under Not recognised. Nothing is copied yet.
8. While the sort runs, look at the summary.
   Expect: **Create project** is disabled, with the checklist line "Sorting files… Create when it
   finishes". It enables when the sort ends.
9. Leave the page mid-sort and come back.
   Expect: the draft is intact; the result appears when the sort is done. **Discard draft** mid-sort
   cancels the sort.
10. Drop or browse to a single photo file (not its folder).
    Expect: the slot and the summary say "The whole folder <name> will be imported", before you create.
11. Drop more than 16 items.
    Expect: a notice says how many were left out and to drop the rest when the sort finishes.
12. Drop a folder with a `.las`: 3D point cloud fills and the photo slots keep theirs. Drop a folder with
    `Thumbs.db`, a `.dwg` and an `.mp4`: Not recognised lists "unknown type", the DWG to DXF advice and
    "Video import is coming".
13. Drop a whole drive (or a folder with more than 50,000 files).
    Expect: "Not everything was sorted: the folder holds more than Kestrel sorts at once. Drop a
    narrower folder, or add the rest later from the project's tabs." Start a large sort and cancel it in
    Jobs: the Data card returns to empty and nothing was copied.
14. Drop a USB stick root and pull it mid-sort.
    Expect: the job finishes; the lost folders are listed as "could not open this folder".
15. Blank template; drop a folder with an orthomosaic and a DSM `.tif`.
    Expect: the page suggests Mapping and survey; choose it and both land in their slots.
16. Browse on Asset drawings and pick a PDF: it lands in that slot. In Mapping, drag an ortho onto
    Elevation: it moves; onto Raw images: refused. The Move menu offers the slots, Not used and Skip;
    **Use again** restores a skipped one.

## Anomalies on the setup page

17. Open a type's details on the Anomalies card (Details of Corrosion).
    Expect: Definition and Severity rules. **Add rule** adds a rule; a blank condition is not saved, and
    the row says "Rule 1 needs a condition. Say when it applies, or remove it." once you tab out of it.
    A rule problem holds **Create project** until it is fixed or the rule removed.
18. Add from Catalogue a type with hotkey 3.
    Expect: both rows are flagged ("Hotkey 3 is used by ...") and Create is off until one key changes.
    **New type** adds a type of your own.
19. With the Catalogue unavailable (stop the backend before opening the page, or block it): only Blank is
    offered, with the reason and Try again; Create still works.

## Catalogue type editor (definition and severity rules)

20. Open **Catalogue** and the Types tab, then click Crack.
    Expect: Definition under Group with a "0 / 1000" counter that follows typing and stops at 1000.
    Severity rules shows "No rules yet...".
21. **Add rule**: the cursor lands in "Rule 1 condition" and the level is Crack's default severity. Add a
    second rule and pick 4 Critical. With focus in rule 2, press Alt+Up: it moves to the top and focus
    follows; Move up and Move down do the same; the top rule's Move up is disabled; **Add rule** is
    disabled at 8 of 8.
22. **Save type** and reopen Crack: the definition and rules come back in order. An object type
    (Excavator) shows Definition and Severity rules too. A new type with only a name saves as before.
23. Catalogue, Severity: remove the top level and save; reopen Crack.
    Expect: that rule shows "Level 4 (removed)" in red; renaming still saves; changing the rules says
    "Rule 1 uses level 4, which is no longer on the severity scale. Choose another level." until fixed.

## Create a project from a delivery folder

24. With the Vertical template, a name, a folder and the sorted delivery folder, click **Create project**.
    Expect: the new project's Overview opens straight away. For a moment "Setup: starting n imports…"
    may show; then it goes, and the Jobs card shows Import (and Drawing import) running.
25. Open **Jobs**.
    Expect: one Import job for the photos folder (not two), and the drawing's jobs. At most 4 drawings
    are inspected at once, however many you dropped.
26. When the import has finished, open the project's photos.
    Expect: the visual and the thermal photos are both there, as one source.
27. Open **Maps** and the layers list.
    Expect: the PDF drawing is there, imported on its own, waiting to be placed with control points
    (unless the file carried its own coordinates).
28. Open **Catalogue**.
    Expect: the 7 anomaly types are there, each with a definition and (for rules you added) the rules.
    A type you already had with the same name was reused, not duplicated.

## When something needs you

29. Start another project with the Vertical template and sort the delivery folder. Before clicking
    **Create project**, rename the photos folder on disk. Then click **Create project**.
    Expect: the Overview opens with "Setup: 1 import failed", listing Visual photos and Thermal photos
    with the reason and a **Retry** on each. Rename the folder back and click **Retry** on either slot:
    the notice goes away and one Import job starts in Jobs.
30. Start another project and drop a folder that holds the multi-page PDF, then create it.
    Expect: "Setup: 1 drawing needs your choice" with the file name, "This PDF has n pages. Choose the
    page to import." and **Finish drawing import**. Clicking it opens Add data, Drawing with the file
    already filled in; choose a page and import.
31. With a notice showing, click **Dismiss** (the x), open another screen and come back.
    Expect: the notice stays gone; the jobs are unaffected.
32. Drop a folder that holds more than 200 files for one non-photo slot, then create.
    Expect: the notice names the rest even if nothing else needs you: "Setup: n files not started", with
    "<n> more files in <folder> were not started — import them from the Maps tab" (Point clouds for a
    point cloud).

## Other templates and choices

33. New project, **Mapping and survey**; drop the folder with the orthomosaic and the DSM.
    Expect: the ortho lands in Orthomosaic and the DSM in Elevation without any dragging. Create it:
    Map import and Elevation import jobs start. The elevation comes in as a DSM named after the file
    (change it to DTM in Maps if it is one).
34. New project; drop the delivery folder; on the Data card **Skip** the Asset drawings bucket; create.
    Expect: no drawing import starts; the photos import as before.
35. New project, **Confined space inspection**.
    Expect: the video slot shows "Video import is coming", and Create never starts a video import.
36. Start a project, click **Create project**, and at once click **Projects** in the sidebar before the
    Overview has settled; then reopen the project.
    Expect: every import was still started (Jobs), and the Overview shows no failure.
37. Put an orthomosaic GeoTIFF inside the photos folder (for example `DCIM\...\products\ortho.tif`),
    start a Mapping and survey project from the delivery folder and create it.
    Expect: the Map import starts; the photos do not, and the Overview says "Photos in <folder> were
    not imported: the folder also holds GeoTIFFs, which a photo import would take as photos. Move the
    GeoTIFFs out of it, then Retry." Move the GeoTIFF out and click **Retry**: one Import job starts,
    and no GeoTIFF appears among the photos.

## Checks only you can do

- Steps 7 to 10 and 24 to 26 with a full-size real delivery (hundreds of photos): sorting finishes in
  seconds and never reads image pixels; the page stays responsive.
- Step 30 with a DXF that names its EPSG code: it is placed by coordinates without asking.

## By hand against the API (no UI; dev backend)

These cover U1 and U2, which have no screen of their own.

- `GET /api/v1/project-templates`: the 3 built-ins first, `builtin: true`. `POST` a template named
  "Bridge deck": 201; again as "bridge_DECK": 409 `template_name_taken`. `PATCH
  /project-templates/builtin-vertical`: 409 `template_builtin`.
- `POST /api/v1/catalogue/types/ensure` with the Vertical types and `dry_run: true`: `id: null`,
  `created: true`, nothing new in the Catalogue; without `dry_run`, types are created with origin
  `template`.
- `POST /api/v1/projects` with those ids and hotkeys: a project with those keys; a hotkey for an id not
  in `type_ids`: 422 `hotkey_invalid`, no folder created.
- Shrink the severity scale to 3 levels: rules on level 4 are dropped, the rest keep their order.

## Follow-ups (not done in S1)

Items for later work, nothing here blocks S1.

- A skipped photo bucket nested in (or sharing) a dispatched photo folder is still imported, because
  photo import is per folder; the page does not say so.
- `POST /sources` takes no per-source file list or extension filter (ADR
  `2026-10-01-photo-import-is-per-folder`); with one, a hand-picked subset or a skipped nested bucket
  could be honoured.
- S4: make the Confined template's video slot required (0003 is frozen, so it needs its own catalogue
  revision) and compare 0003's frozen copy with the pre-S4 literal in
  `test_catalogue_migration_0003.py::test_the_migration_carries_a_frozen_copy` and the Confined row in
  `test_setup_builtins.py`.
- S4: turn video on with `app/setup/classify.py::VIDEO_IMPORT_ENABLED = True`.
- S1 contract, next edit (U6 did not take it): reword `ProjectCreate.hotkeys` (null means no override,
  the catalogue key applies); optionally declare 409 `type_exists` on ensure and 422
  `invalid_severity_rule` on createCatalogueType, patchCatalogueType and ensure.
- A legacy migrated type with a non-hex colour makes ensure answer 500 (`TypeConflict.colour` must be
  hex).
- Quiet-ignore DJI sidecars (`.MRK`, `.nav`, `.obs`, `.bin`, `.SRT`) and `Thumbs.db` instead of listing
  them as Not recognised; drop `samples` for non-image buckets to shrink the worst-case inspect result
  (about 5 to 8 MB).
- U5 deferred: arrow keys on the template radio group; the catalogue picker is silent at 64 types; the
  overflow notice is lost when you leave mid-sort; duplicate bucket labels across DJI cards; the
  severity select shows "No default" for an out-of-scale default; e2e files need prettier.
- U6 minors left as they are: a start after dismiss while an old run is still in flight could patch
  colliding unit ids; the evidence screenshots are cropped to the viewport because the app scrolls
  inside a container (see the task report).
