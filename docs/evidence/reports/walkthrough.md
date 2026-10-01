# Reports: operator walkthrough

One run through the Reports tab after sub-project R (spec `docs/superpowers/specs/2026-09-26-reports-design.md`).
You need a project with photos, a map and a point cloud, and at least one finding on each (an image
box on a defect type, a map pin, a 3D pin), a map measurement, and a site photo you can attach to a
finding. A second, empty project is used in step 17. Labels are the merged UI's (R6/R7/R8); the
screenshots in this folder come from the opt-in real-backend e2e (`pnpm -C frontend e2e:reports`).

1. Open the project and click the **Reports** tab.
   Expect: the heading "Reports" with a **Reports | Data exports** switch under it; the list says
   "No reports yet", with **New report**.
2. Click **New report**, pick **Full inspection report** (each choice shows its description, built-ins
   are marked "Built-in"), keep or type a title, click **Create report**.
   Expect: the builder opens: sections left, white A4 sheets in the centre, settings right. The
   filters show a live count, "Counting findings…" then e.g. "3 findings match". Above the sheets:
   "Not rendered yet · about N pages now". Every edit shows "Saving…" then "Saved" next to the title.
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
4. Look at the warnings chip in the top bar.
   Expect: "1 warning" (or more). Click it: "1 3D view is missing"; its **Open to fix** link opens
   Point clouds with that finding selected. A 3D view whose pin moved after capture prints with "(out
   of date: the anchor moved after capture)" and the chip says "1 3D view is out of date".
5. In **Filters**, tick **Closed**.
   Expect: the count updates within about half a second; nothing else moves. Pick a level under
   **Severity at least** (e.g. Moderate): an **Include ungraded findings** checkbox appears, unticked;
   pick **Any** again before going on.
6. Open the **Options** of **Finding pages** and set **Photos per finding** to 0.
   Expect: "0 leaves the photos out."; the photo cells disappear from the finding pages in the
   preview. Unticking **Context inset** (if you try it) hides the locator in the corner of the crop.
7. Focus the **Measurements** row and press **Alt+↑** until it is above **Findings table** (or drag
   its **Reorder Measurements** handle).
   Expect: the row moves; a screen reader hears the new position; the preview's Measurements section
   now comes before the findings table. **Cover** cannot be moved. With **Settings → Reduce motion**
   on, the move is instant. The eye button **Show Measurements in preview** scrolls the preview there.
8. Switch a section off and on again.
   Expect: its sheet collapses and returns; the cover stays pinned first when enabled.
9. Open the chevron next to **Render** (**Render options**; the menu is **Render formats**), tick
   **XLSX** (**PDF** stays ticked and cannot be unticked), press Escape, click **Render**.
   Expect: the **History** drawer opens on a job card with phases (compose, snapshots, PDF, tables)
   and a progress bar that only moves forward; you can keep editing and scrolling while it runs.
   Clicking **Render** again while it runs only opens History (the API says "This report is already
   rendering"). An edit made after clicking Render does not change this render: it prints the
   settings from the moment you clicked.
10. Start a render and press **Cancel job** on its job card.
    Expect: the job ends as cancelled; no new version appears in History; the next render still gets
    the next number.
11. Render again and wait for it to finish (toast "Report rendered"). The History drawer lists it
    (open it with **History**, close it with **Close history** or Escape).
    Expect: v1, "Ready", with its page count ("10 pages") and files `<project>-<report>-v001.pdf` and
    `findings.xlsx`; the line above the sheets now reads "N pages at the last render · about N pages
    now".
12. Click **Open PDF** (installed app).
    Expect: the PDF opens in your default viewer: gradient cover with the title, logo chip if set,
    "Draft"; page furniture "Kestrel AI · <project> · page n / N"; bookmarks per section and per
    finding. Figures (including 3D views at 170 mm wide) print sharp.
13. Print one finding page in greyscale (or preview it greyscale).
    Expect: every severity reads as a word next to a dot ("Moderate"), never colour alone.
14. Click **Show in folder** on v1, then open `findings.xlsx`.
    Expect: Explorer shows the version folder (`reports\<id>\v001\` with the PDF, `findings.xlsx` and
    `document.json`); the workbook has Findings (frozen header, autofilter, severity cells filled with
    the scale colour; a note typed as `=1+1` stays text), Measurements and Report sheets.
15. Click **Mark as issued** on v1. Then click **View v1**.
    Expect: v1 shows an "Issued <d Mon>" pill and offers **Unissue** instead of **Mark as issued** and
    **Delete version**: an issued version cannot be deleted (the API refuses with "An issued version
    cannot be deleted. Unissue it first."). **View v1** shows the frozen v1 read-only with "Viewing v1
    (read only)" and **Back to draft** (close History first at 1280 px: the drawer covers it). A draft
    (unissued) version's **Delete version** asks to confirm, then removes the row and its folder.
16. In the Findings tab, close the map finding and raise the cloud finding's severity. Come back to the
    report.
    Expect: the executive summary's change cards read Closed 1, Escalated 1, and the line under them
    "1 closed · 1 escalated since v1". Render: v2 appears with the same strip; v1 stays "Issued".
17. Tick every item under **Data items** in **Filters**, then **Save as template** with a name and
    **Save template**.
    Expect: the dialog says data-item filters, the logo and the report date are not kept. Open the
    second project → Reports → **New report** → your template: the same sections in the same order,
    photos still 0, and no data items ticked. Back on its list, the card's **Actions for <title>** menu
    offers **Duplicate** and **Delete** (never rendered); the first project's report offers
    **Duplicate** and **Archive**.
18. Click **Data exports** (or ←/→ on the switch).
    Expect: the address is `/p/<project>/reports/exports`; the Counts and Results exports (the HTML
    option reads "Image contact sheet (HTML)"), **Exports in their workspaces** with **Open the Map
    workspace**, **Open Point clouds** and **Open surfaces and volumes**, and **Past exports** (now
    also volume and point-cloud exports, as "Export volumes" / "Point cloud export"). The Counts export
    has no PDF option; **Create a Survey count report** opens the New report dialog with Survey counts
    picked (the `?new=` in the address is dropped). The **More** menu no longer lists "Export".
19. Run a results export and a counts CSV.
    Expect: both finish as jobs and appear in Past exports with **Show in folder**.
20. Paste an old address `/p/<project>/export`.
    Expect: you land on Reports → Data exports. A finished map export's toast **Open data exports**
    lands there too.
21. Close the app during a render, then start it again.
    Expect: the render shows as "Render failed" ("Interrupted by an application restart. Render the
    report again."); no half-written version is listed and no `.partial-*` folder is left under
    `reports\<id>\`. The next render removes the failed row.

## Checks only you can do

1. **Print quality (step 12).** Open v1's PDF in your viewer: cover gradient, logo chip, page
   furniture, bookmarks, figure sharpness. The e2e checks the files and page counts, not how they look.
2. **Greyscale legibility (step 13, §18 criterion 5).** Print or preview a finding page in greyscale;
   every severity must read as its word. The unit test pins the word, not the printed contrast.
3. **Closing mid-render (step 21).** Quit the installed app while a render runs and start it again;
   the version must show as failed with no `.partial-*` folder. Headless tests cannot quit the shell.

## Operator-visible rulings

- The live preview is content-exact, layout-approximate: page breaks are only known after a render;
  the history shows the real page count. (spec §4)
- The detection per-source PDF is gone from Data exports; the endpoint keeps `format: pdf` for one
  release, marked deprecated. (R8)
- Word output, in-app PDF viewing and one merged PDF above the part budget are deferred. (spec §20)
- Reports print in Space Grotesk, which has no Cyrillic, CJK or emoji glyphs: such characters in a
  title, note or comment print as missing-glyph boxes. (R4, R10)
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

## Sources

- Plans: `docs/superpowers/plans/2026-09-30-reports-index.md`, `2026-09-30-reports-r0.md` to
  `2026-09-30-reports-r10.md` (R9 as `-r9c`, `-r9i`, `-r9m`); rulings R10-1 to R10-6 in the R10 plan.
- `docs/progress.md`: no R unit wrote its own entry; this unit's entry "Reports lands — 2026-09-30".
- `.superpowers/sdd/imc-common/walkthroughs/`: `r-r0.md`, `r-r1.md`, `r-r2.md`, `r-r3.md`,
  `r-r4.md`, `r-r5.md`, `r-r6.md`, `r-r7.md`, `r-r8.md`, `r-r9c.md`, `r-r9i.md`, `r-r9m.md`.
- `.superpowers/sdd/imc-common/handoffs.md`: every "Reports" section (from R0, R1, R2, R3, R4, R5,
  R6, R7, R8, R9-I, R9-M and R9-C).
- `.superpowers/sdd/2026-09-30-reports-r10/task-3-report.md` (the UI handle → accessible-name table).
- Screenshots: `builder.png`, `history-v1.png`, `deltas-v2.png`, `template-second-project.png`,
  `data-exports-real.png` (real backend), `data-exports.png` (Prism mock).
