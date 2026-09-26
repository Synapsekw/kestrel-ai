---
type: usability
date: 2026-09-23
---

# Detection workspace: operator walkthrough

This is the "how to test this" for the detection workspace (plan
`2026-09-23-detection-workspace`, spec `2026-09-23-train-detect-split-and-model-library-design`
§7–§10). Run it on the **real app against the real backend**.

The browser tests (`frontend/e2e/sources.spec.ts`, `runs.spec.ts`, `detect-review.spec.ts`,
`analytics.spec.ts`, `detect-export.spec.ts`) run against the Prism mock with fixed examples. The
backend test `tests/test_detect_flow.py` runs the whole flow with a fake model on a synthetic map.
Neither opens your data or runs real weights. This walkthrough does both.

**Before you start:** you need

- a folder of drone photos from one flight (a few hundred is enough), for example a copy of
  `E:\Dev\Yolo\Ahmadia Construction Data`;
- one GeoTIFF orthomosaic of the same site;
- a detection model in the **Library** (a trained one, or a starter model).

Work in a **new** detection project. Nothing here changes the photo or map originals; the app only
reads them.

Each step says what you should see. If a step does not match, stop and report which one.

1. **Create a detection project.** On **Projects**, choose **Detection project**, give it a name
   and a new folder, and click **Create project**. The sidebar shows, in order: **Sources**,
   **Runs**, **Review**, **Analytics**, **Export**, and below a divider **Site areas**. There is
   no Images, Label, Datasets, Train, Detect, Maps or Surveys entry.
2. **Add the photos.** Open **Sources** and click **Add photos**. Pick the photo folder and start
   the import. The row appears with a **Photos** pill and an "Importing" bar; when the job
   finishes, it shows the number of photos and "No run yet".
3. **Add the map.** Click **Add a map**, choose the GeoTIFF and start the import. A second row with
   a **Map** pill appears. When it is ready, its size shows the pixel size and the ground size, and
   an **Open map** button appears.
4. **Date the surveys.** Click the survey date of each row ("date not set", or the date read from
   the file). A date field opens: pick the day the flight was flown and click **Save**. The list
   re-sorts newest survey first. Press **Escape** in an open date field: the edit is cancelled and
   the old date stays. A map's survey date and its map are one: reload **Sources** and the map row
   still shows the date you saved.
5. **Run a model, and match its classes once.** On the map row, click **Run a model**. **Runs**
   opens with the **New run** dialog and the map already ticked. Tick the photo batch too, pick
   your library model and click **Start 2 runs**.
   - If the project has no classes yet, the runs just start: the project takes its classes from
     the model.
   - If the model has classes the project lacks, the dialog turns into **Match the model's
     classes**: one row per class, each with **Counts as**. Pick a project class, "Add … as a new
     class", or "Ignore". **Save and start** is refused until every class has an answer ("Ignore
     the rest" and "Add the rest as new classes" fill the blanks). After saving, the runs start.
     Start another run with the same model: the question is **not** asked again.
6. **Runs finish as jobs.** The **Jobs** button in the header counts both runs with progress; the
   app stays usable while they run. When they finish, each row in **Runs** shows the model, the
   confidence, the counts per class as "total (verified)", and "0 of N reviewed". The map row says
   **objects**; the photo row says **detections**. Back on **Sources**, the "Latest run" column
   shows the same numbers.
7. **Pin a run.** If a source has two runs, click **Pin** on the older one. It shows **Pinned**,
   the other run of that source is unpinned, and **Sources** and **Analytics** now count with the
   pinned run.
8. **Review the map from the keyboard.** Open **Review**. The **Source** picker lists every source
   with its kind and date; pick the map. It shows the run's model, confidence and "N of M
   reviewed". Click **Review on the map**. The map viewer opens in review mode, framed on the first
   unreviewed detection, with the review panel on the right.
   - Press **A**: the detection is accepted and the next one is framed; the progress line goes up
     by one.
   - Press **R**: rejected, next.
   - Press a class number (**1**–**9**, the hotkeys shown in "Wrong class?"): the detection takes
     that class and counts as verified.
   - Press **N**: skipped, nothing is decided.
   - Click **Draw missed object**, drag a box around an object the model missed: it is added and
     counts as verified.
   - Type a value into **Minimum confidence** and click **Accept all at or above**: a job runs, and
     afterwards the progress jumps.
9. **Review the photos.** Back in **Review**, pick the photo batch. The photos with detections
   waiting are listed, most confident first. Open one: the editor shows the run's boxes; **A** and
   **R** accept and reject as before. Back in **Runs**, both rows now show their verified numbers
   and review progress.
10. **Outline a site area.** Open **Site areas**, pick the map and click **Draw an area**. The map
    opens with "Click around the site area to outline it". Click around a yard, double-click to
    finish, name it (for example "North laydown yard") and click **Save site area**. A recount job
    runs. Draw a second area that runs off the edge of the map.
11. **Analytics.** Open **Analytics**.
    - **Surveys:** one row per map survey with "total (verified)" per class, and a chart once
      there are two map surveys.
    - **Per source:** pick any source; the map says objects, the photos say detections.
    - **Site areas:** the two areas with their counts for the chosen survey. The area that runs off
      the map carries a **partly covered** pill.
    - **Photo batches:** under the caption "Detections in photos (not object counts: the same
      object appears in several photos)". Photo numbers are never added to the survey chart.
    - Switch **Verified only** on: every number drops to what a person accepted or drew, and the
      intro says "Verified objects in each survey". Switch it off again.
    - The numbers match what **Runs** shows for the same runs.
12. **Old addresses still open.** Type `/p/<project id>/surveys` into the address (or use an old
    bookmark): you land on **Analytics**.
13. **Export the counts.** Open **Export**. Under **Counts**:
    - With **Table (CSV)** and **All sources**, click **Export**. A job runs; the file
      `detect-<project>-<date>.csv` appears under **Past exports**; **Show in folder** opens it. Open
      it in Excel: one row per source × class × site area (area empty means the whole source),
      with the columns `survey_date, source, source_kind, unit, model, confidence, class, area,
      total, verified`. The totals match **Analytics**.
    - Choose **Report (PDF)** and the map in **Sources**, then **Export**. The PDF
      (`detect-<source>.pdf`) shows the project, source, date, model, confidence and review
      progress, an overview picture of the map, a class table, a site-area table and a footnote
      explaining how the counts were made. A PDF for the photo batch shows a 3×3 sheet of photo
      thumbnails and says that the same object can appear in several photos.
    - In the map viewer, export the map's detections as a **GeoPackage** and open it in QGIS: the
      detections carry their `review_state` and class name, and there is a `site_areas` layer.
14. **A training project is unchanged.** Open a training project. Its sidebar still reads Images,
    Label, Datasets, Train, Review, Export, and typing `/p/<id>/sources` lands on its Home.
15. **An old Detect-screen link still narrows Review.** In the detection project, open the old
    Detect screen at `/p/<project id>/query`, and on a run card click **Review results**. Review
    lists only that run's photos, says "… of the N images of this detection run still have
    suggestions to review", and offers **Show the whole queue**.
