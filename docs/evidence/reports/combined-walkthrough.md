# Reports close-out: operator walkthrough (installed build)

One run through the installed app built at `8aead7b`
(`E:\Dev\Yolo\installers\Kestrel AI_0.1.0_x64-setup-8aead7b.exe`, SHA256
`a46309311a58f40b31469cd631a3208fbd9661cced957f769c6054680fd70c7c`). Install it first. Part A is the
Reports run; Part B carries the operator checks still open from the I/M/C wave (no later progress
entry records their results).

## Part A — Reports

Part A is one run through the Reports tab after sub-project R (spec
`docs/superpowers/specs/2026-09-26-reports-design.md`).
You need a project with photos, a map and a point cloud, and at least one finding on each (an image
box on a defect type, a map pin, a 3D pin), a map measurement, and two site photos and two comments on
the image finding (added in its finding panel). A second, empty project is used in step 19. Labels are
the merged UI's (R6/R7/R8); the screenshots in this folder come from the opt-in real-backend e2e
(`pnpm -C frontend e2e:reports`).

1. Open the project and click the **Reports** tab.
   Expect: the heading "Reports" with a **Reports | Data exports** switch under it; the list says
   "No reports yet", with **New report**.
2. Click **New report**, pick **Full inspection report** (each choice shows its description, built-ins
   are marked "Built-in"), keep or type a title, click **Create report**. Then in the settings'
   **Cover**, click **Choose logo** and pick a PNG (in a browser dev run: type a path and **Add
   logo**); try a non-image file once.
   Expect: the builder opens: sections left, white A4 sheets in the centre, settings right. The
   filters show a live count, "Counting findings…" then e.g. "3 findings match". Above the sheets:
   "Not rendered yet · about N pages now". Every edit shows "Saving…" then "Saved" next to the title.
   The logo shows "Logo added · W × H px" and appears top right on the preview's cover on a white
   chip; the non-image file shows its reason inline under the button and nothing is added.
   A logo file over 20 MB is refused with a message.
3. Scroll the preview.
   Expect: sections and figures load as they come into view (a skeleton first). The cover has the
   violet-to-teal band with the title. The image finding's page shows a 4:3 crop with its outline in
   the type colour, an "F-0001 · Crack" tag and a small locator of the whole photo in the corner; the
   map finding a map crop with a pin, scale bar, north arrow and an inset; the cloud finding a grey
   placeholder "No 3D view saved. Open this finding in Point clouds to capture one" (unless you
   captured one in Point clouds: then the 3D view, captioned "3D view, captured <date>"). An image
   finding with GPS also shows "Location on <map> · <date>". Measurements has a table per kind (the map
   measurement's figure draws its line or polygon on its map; a volume shows fill, cut, net and a plan
   view, or "stale, recalculate" without numbers if its polygon changed since the last calculation).
   Survey comparison shows a swipe and a side-by-side per consecutive pair of maps ("One survey so far:
   nothing to compare." with a single map; "… — no common area" for maps that do not overlap). Object
   counts lists photo batches as "detections", not objects.
4. Look at the warnings chip in the top bar. (For a missing 3D view, either never capture one for
   the cloud finding, or delete its view file in `<project>\pointclouds\<cloud>\views\` and reopen
   the report.)
   Expect: "1 warning" (or more). Click it: "1 3D view is missing"; its **Open to fix** link opens
   Point clouds with that finding selected. A 3D view whose pin moved after capture prints with "(out
   of date: the anchor moved after capture)" and the chip says "1 3D view is out of date".
5. In Point clouds, build a surface from that cloud, then come back to the report.
   Expect: the cloud finding's page now prints "Plan view of <surface>: no 3D view saved", a hillshade
   with the pin, instead of the grey placeholder. The chip still lists the missing 3D view.
6. In Point clouds, open the **Findings** tab's menu and click **Capture missing views**; wait for
   "Saving views n / N" to finish. Come back to the report.
   Expect: every cloud finding's page prints its 3D view ("3D view, captured <date>"); the chip no
   longer lists 3D views (it disappears if that was the only warning).
7. In **Filters**, tick **Closed**.
   Expect: the count updates within about half a second; nothing else moves. Pick a level under
   **Severity at least** (e.g. Moderate): an **Include ungraded findings** checkbox appears, unticked.
   Click a type chip under **Types**, and under **Date** pick a range and set **From** / **To**: the
   count follows each change. Put **Any**, **All types** and **All dates** back before going on
   (keep **Closed** ticked).
8. Open the **Options** of **Finding pages** and set **Photos per finding** to 0.
   Expect: "0 leaves the photos out."; the photo cells disappear from the finding pages in the
   preview. Unticking **Context inset** (if you try it) hides the locator in the corner of the crop.
9. Focus the **Measurements** row and press **Alt+↑** until it is above **Findings table** (or drag
   its **Reorder Measurements** handle).
   Expect: the row moves; a screen reader hears the new position; the preview's Measurements section
   now comes before the findings table. **Cover** cannot be moved. With **Settings → Reduce motion**
   on, the move is instant. The eye button **Show Measurements in preview** scrolls the preview there.
10. Switch a section off and on again.
    Expect: its sheet collapses and returns; the cover stays pinned first when enabled.
11. Open the chevron next to **Render** (**Render options**; the menu is **Render formats**), tick
    **XLSX** (**PDF** stays ticked and cannot be unticked), press Escape, click **Render**.
    Expect: the **History** drawer opens on a job card with phases (compose, snapshots, PDF, tables)
    and a progress bar that only moves forward; you can keep editing and scrolling while it runs.
    Clicking **Render** again while it runs only opens History (the API says "This report is already
    rendering"). An edit made after clicking Render does not change this render: it prints the
    settings from the moment you clicked.
12. Start a render and press **Cancel job** on its job card.
    Expect: the job ends as cancelled; no new version appears in History; the next render still gets
    the next number.
13. Render again and wait for it to finish (toast "Report rendered"). The History drawer lists it
    (open it with **History**, close it with **Close history** or Escape).
    Expect: v1, "Ready", with its page count ("10 pages") and files `<project>-<report>-v001.pdf` and
    `findings.xlsx`; the line above the sheets now reads "N pages at the last render · about N pages
    now".
14. Click **Open PDF** (installed app only: Open PDF and Reveal use Windows).
    Expect: the PDF opens in your default viewer: gradient cover with the title, logo chip if set,
    "Draft"; page furniture "Kestrel AI · <project> · page n / N"; bookmarks per section and per
    finding. Figures (including 3D views at 170 mm wide) print sharp.
15. Print one finding page in greyscale (or preview it greyscale).
    Expect: every severity reads as a word next to a dot ("Moderate"), never colour alone.
16. Click **Show in folder** on v1 (installed app only: Open PDF and Reveal use Windows), then open `findings.xlsx`.
    Expect: Explorer shows the version folder (`reports\<id>\v001\` with the PDF, `findings.xlsx` and
    `document.json`); the workbook has Findings (frozen header, autofilter, severity cells filled with
    the scale colour; a note typed as `=1+1` stays text), Measurements and Report sheets.
17. Click **Mark as issued** on v1. Then click **View v1**.
    Expect: v1 shows an "Issued <d Mon>" pill and offers **Unissue** instead of **Mark as issued** and
    **Delete version**: an issued version cannot be deleted (the API refuses with "An issued version
    cannot be deleted. Unissue it first."; step 22 unissues and deletes it). **View v1** shows the
    frozen v1 read-only with "Viewing v1 (read only)" and **Back to draft** (close History first at
    1280 px: the drawer covers it).
18. In the Findings tab, close the map finding and raise the cloud finding's severity. Come back to the
    report.
    Expect: the executive summary's change cards read Closed 1, Escalated 1, and the line under them
    "1 closed · 1 escalated since v1". Render: v2 appears with the same strip; v1 stays "Issued".
19. Tick every item under **Data items** in **Filters**, then **Save as template** with a name and
    **Save template**.
    Expect: the dialog says data-item filters, the logo and the report date are not kept. Open the
    second project → Reports → **New report** → your template: the same sections in the same order,
    photos still 0, and no data items ticked. Back on its list, the card's **Actions for <title>** menu
    offers **Duplicate** and **Delete** (never rendered); the first project's report offers
    **Duplicate** and **Archive**. A project with more than 50 reports shows **Load more reports**
    under the list.
20. Back in the first project's report, untick the data items, set **Photos per finding** to 2, and
    under **Comments** pick **Last**, then **All**.
    Expect: the image finding's page shows its two photos as small cells under the figure, then the
    comments: only the newest with **Last**, the whole thread with **All**.
21. Delete one of that finding's photo files in `<project>\findings\<id>\`, come back to the report,
    and **Render**.
    Expect: that photo cell shows a grey "photo file is missing" placeholder in the preview; the render
    still completes (v3) and its PDF prints the same placeholder.
22. In History, click **Unissue** on v1, then **Delete version** on it and confirm.
    Expect: the confirmation says its files are removed and the next render still gets the next
    number; v1's row disappears and its `reports\<id>\v001\` folder is gone.
23. Click **Data exports** (or ←/→ on the switch).
    Expect: the address is `/p/<project>/reports/exports`; the Counts and Results exports (the HTML
    option reads "Image contact sheet (HTML)"), **Exports in their workspaces** with **Open the Map
    workspace**, **Open Point clouds** and **Open surfaces and volumes**, and **Past exports** (now
    also volume and point-cloud exports, as "Export volumes" / "Point cloud export"). The Counts export
    has no PDF option; **Create a Survey count report** opens the New report dialog with Survey counts
    picked (the `?new=` in the address is dropped). The **More** menu no longer lists "Export".
24. Run a results export and a counts CSV.
    Expect: both finish as jobs and appear in Past exports with **Show in folder**.
25. Paste an old address `/p/<project>/export`.
    Expect: you land on Reports → Data exports. A finished map export's toast **Open data exports**
    lands there too.
26. Close the app during a render, then start it again.
    Expect: the render shows as "Render failed" ("Interrupted by an application restart. Render the
    report again."); no half-written version is listed and no `.partial-*` folder is left under
    `reports\<id>\`. The next render removes the failed row.

### Checks only you can do (Reports)

1. **Print quality (step 14).** Open v1's PDF in your viewer: cover gradient, logo chip, page
   furniture, bookmarks, figure sharpness. The e2e checks the files and page counts, not how they look.
2. **Greyscale legibility (step 15, §18 criterion 5).** Print or preview a finding page in greyscale;
   every severity must read as its word. The unit test pins the word, not the printed contrast.
3. **Closing mid-render (step 26).** Quit the installed app while a render runs and start it again;
   the version must show as failed with no `.partial-*` folder. Headless tests cannot quit the shell.

## Part B — Open checks carried from the I/M/C wave

These four are from "Checks only you can do" in `docs/evidence/imc/walkthrough.md`; step numbers
refer to that walkthrough.

1. **C-G pending operator checks.** Criterion 4 chimney row and criterion 5 hand check: IMC walkthrough step 84.
   Criterion 7 (photo link by eye): IMC walkthrough step 85. Criterion 8 (image to cloud by hand): IMC walkthrough step 86. Record the
   results in `docs/evidence/clouds/README.md` and `docs/progress.md`.
2. **M-X real-data checks.** M-X's acceptance ran on synthetic stand-ins, so these need your data:
   DSM import against the cloud's DSM (Z within about 2 cm, IMC walkthrough step 58), a real DXF placed by its CRS
   (within 10 cm, IMC walkthrough step 59), and a scanned PDF aligned by four points (IMC walkthrough step 60). Also confirm DXF
   linework click-to-select in the installed app (IMC walkthrough step 38); M-W5 left it untested and M-X only tried
   it in dev.
3. **I-E capture map at scale.** On the installed WebView2 build, open a capture map with about 20,000
   points (**Shift+M**) and drag-pan and zoom it (IMC walkthrough step 28). Headless tests on SwiftShader locked at
   10,000 points or more, so the pan was never measured. Note whether your real GPU also stutters; if
   it does, that is I-FB's clustering / level-of-detail work.
4. **Resized input fields.** C-G fixed the shared `ui/Input` and `ui/Slider` overflow; the fix changes
   every sized input and slider. Eyeball: Catalogue types, Sources survey date, Site areas rename, Map
   layers and drawings, and the cloud height offset (IMC walkthrough step 81).

## Operator-visible rulings

- The live preview is content-exact, layout-approximate: page breaks are only known after a render;
  the history shows the real page count. (spec §4)
- The detection per-source PDF is gone from Data exports; the endpoint keeps `format: pdf` for one
  release, marked deprecated. (R8)
- Word output, in-app PDF viewing and one merged PDF above the part budget are deferred. (spec §20)
- Reports print in Space Grotesk, which has no Cyrillic, CJK or emoji glyphs: such characters in a
  title, note or comment print as missing-glyph boxes. (R4)
- With the default statuses [open, reviewed], a finding closed since the baseline leaves the filtered
  set and counts as "left the report", not "closed". Tick **Closed** in Filters to count closures.
  (R2, R10)
- Ungraded findings are included while **Severity at least** is **Any**. Picking a level unticks
  **Include ungraded findings**; tick it to keep them. A report or template saved through the API
  without the flag still includes them. (R1, R7)
- A template keeps the measurement picks and explicit survey-comparison pairs it was saved with; in
  another project those ids match nothing, so Measurements comes out empty and the comparison warns
  "N comparison pair(s) name a map that is not ready" (re-pick them, or use automatic pairs). "Works in
  every project" over-claims for those two sections. Data-item filters, the logo and the report date
  are stripped. (R7, parked)
- At 1280 px wide the History drawer covers **Back to draft**; close History first. (R7, parked)
- The preview now goes stale when a map's georeference (bounds, CRS) changes or a cloud measurement
  view is captured or turns stale; missing or stale cloud measurement views show in the warnings chip.
  Rendered PDFs were never affected. (R10)
- A version that failed stays listed as "Render failed" with its reason until the next render removes
  it; a cancelled render leaves no row and no folder. (R5)
- The PDF prints the settings from the moment **Render** was clicked; edits during a queued render go
  to the next one. (R5)
- A large report is written in parts; History then offers **Open part 1**, **Open part 2**, … instead
  of **Open PDF**. (R4, R5)
- **Open PDF** / the open endpoint only opens pdf, csv, xlsx, html, json, txt, png and jpg/jpeg files
  inside the project folder; anything else is refused. A logo is copied into the project (`reports\assets\`,
  at most 1200 px) and may be PNG, JPEG or WebP up to 20 MB. (R1)
- A missing photo file or 3D view prints a grey placeholder with its reason; the render still
  completes. With a surface from that cloud, a missing 3D view prints a plan view of the surface
  instead. (R9-I, R9-C)
- Object counts list photo batches as detections, not objects; a non-overlapping map pair prints
  "no common area". (R9-M)
- Polygon outlines with holes print without their holes in snapshots. (R3, parked)
- Preview sections load only near the visible part of the preview (about 1200 px), so a long report
  fills in as you scroll. (R6)
- The I/M/C rulings in `docs/evidence/imc/walkthrough.md` still apply.

## Sources

- `docs/evidence/reports/walkthrough.md` (R10's 26 steps and checks) and
  `docs/evidence/imc/walkthrough.md` ("Checks only you can do").
- Plans: `docs/superpowers/plans/2026-09-30-reports-index.md`, `2026-09-30-reports-r0.md` to
  `2026-09-30-reports-r10.md` (R9 as `-r9c`, `-r9i`, `-r9m`); rulings R10-1 to R10-6 in the R10 plan.
- `docs/progress.md`: the entries "Reports lands — 2026-09-30" and "Reports closes — 2026-10-01".
- Screenshots in `docs/evidence/reports/`: `builder.png`, `history-v1.png`, `deltas-v2.png`,
  `template-second-project.png`, `data-exports-real.png` (real backend), `data-exports.png` (Prism
  mock).
- Dev-only working notes are git-ignored under `.superpowers/sdd/` and not in the repo (for example
  `imc-common/walkthroughs/` and `imc-common/handoffs.md`).
