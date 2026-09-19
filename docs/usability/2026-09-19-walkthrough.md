# Usability walk-through, 2026-09-19

Walked as a new user on the **installed app** (installer built from main 6eeec68), a second
instance with its own WebView2 profile and CDP port so the operator's running instance stayed
untouched. New project "Walkthrough", 40 frames copied from `data/raw/ahmadia` (evenly spread over
the 7 flights), COCO `yolo11m.pt` imported, 14 images labeled, dataset `v1`, 3-epoch training,
local query over 40 images, review, promote, ONNX export, provider test with an invalid key.
Before-screenshots: `docs/evidence/usability/2026-09-19-before/`.

Severity: **blocks** (the user cannot continue without outside help), **confuses** (the user can
continue but does not understand the state or does the wrong thing), **annoys** (friction only).
The "Closed by" column is filled with the commit that fixes the item.

## Friction list

| Id | Where | What the user sees | What they expected | Severity | Closed by |
|---|---|---|---|---|---|
| N1 | Sidebar on the Projects screen (`Shell.tsx` `navItems`) | Data, Editor, Review, Models, Train, Query, Settings greyed out, no tooltip, no text | "Open or create a project first", or entries that explain themselves | blocks | |
| N2 | Settings / provider keys | Keys are global (Credential Manager, `/api/v1/providers`) but the only way to them is a project's Settings screen | An app-level Settings entry that works with no project open | blocks | |
| G1 | Models -> Import weights, Train -> Base model | The form asks for the path of a `.pt` file; the installer ships none, the base-model list of a new project is empty, nothing says where weights come from | Starter weights (YOLO11 n/s/m) offered in the app, selectable as base model without a file path | blocks | |
| N3 | Sidebar inside a project | "Editor" greyed out with no hint | Hint "open an image from Data or Review" | annoys | |
| N4 | After creating a project | Lands on an empty Data Manager; nothing tells the order import -> label -> dataset -> train -> run -> review | A next-step hint or project overview (counts and the next action) | confuses | |
| N5 | Every `invoke` in the installed app | Console: CSP blocks `http://ipc.localhost`, Tauri falls back to postMessage (invisible to the user, noise in diagnostics) | No CSP violation (`connect-src` allows `ipc:` / `http://ipc.localhost`) | annoys | |
| P1 | Projects -> Create project with an empty or invalid folder | Red "request validation failed" | Which field is wrong and why | confuses | |
| P2 | Projects -> Recent | Test leftovers pile up; no way to remove an entry or delete a project | "Remove from list" per entry | annoys | |
| D1 | Data Manager, empty project | At the very bottom: "No images match. Import a folder from the Projects screen or clear the filters." (import is on this screen, not on Projects) | Centered empty state with an "Import images" action | confuses | |
| D2 | Data Manager after an import | Green "Import started for <path> (job ...)" stays forever; no "imported 40, 0 duplicates, 0 failed" | Completion summary, then the banner goes away | confuses | |
| D3 | Starting any job | Jobs panel opens by itself over the toolbar (covers Import images and the job counter) | Panel stays closed or does not cover the controls; the counter shows progress | annoys | |
| D4 | Import images dialog, Import defaults | "Group regex" shows a raw regular expression; "Max side", "Duplicate threshold" have no unit or explanation | Plain-language help per field; regex under "Advanced" | confuses | |
| D5 | Import images dialog | The error of the previous attempt stays while the folder is edited | Error clears on edit | annoys | |
| D6 | Data Manager list right after the first import | Source column shows `805e6866` (id) until the screen is revisited; the Source filter lacks the new source | Site name at once | confuses | |
| D7 | Data Manager selection | No "select all"; Ctrl+A works but the hint only lists J/K, Enter, Space | Select-all checkbox in the header and in the hint | confuses | |
| D8 | Data Manager grid | Single click only focuses; open needs double-click or Enter; the hint mentions keys only | Hint mentions double-click | annoys | |
| E1 | Editor with a pre-annotation model set | For 2-6 s after opening an image nothing shows that the model is running; the model is not named | "Pre-annotating with <model>..." status | confuses | |
| E2 | Editor, pre-annotation found nothing | "0 proposals from the pre-annotation model" appears (the image jumps down); no reason, no next step; COCO weights found nothing even on a yard full of trucks | Explanation (COCO weights rarely fire on nadir imagery; train a project model and use it) without a layout jump | confuses | |
| E3 | Editor toolbar "Keys" | Looks like a button, a click does nothing; the shortcuts are a native tooltip after ~1 s hover | Click opens a shortcuts popover | confuses | |
| E4 | Editor / datasets: images without machinery | "Labeled" means "has at least one accepted box" (`images.py`); an empty image can never be marked done and never enters a dataset as a negative | "No objects" action that marks the image reviewed and lets it into datasets | confuses | |
| E5 | Editor region list with model proposals | The provenance badge wraps one word per line ("Model / v1- / coco- / m"), each row ~110 px, 67 rows | One-line rows | annoys | |
| E6 | Editor with many proposals | 67 overlapping dashed boxes and labels; no way to hide low-confidence proposals | Confidence slider filtering visible proposals (A/R act on visible ones) | confuses | |
| E7 | Editor requests (ledger S2) | No request timeout: a hung request stalls the per-image queue, "Saving..." forever | Timeout with an error and retry | confuses | |
| E8 | Editor opened from a review of one run | No "back to the queue"; the Review nav entry opens the whole queue, the run filter is lost | Back link that keeps the filter | annoys | |
| S1 | Add to dataset, name "first set" | "request validation failed"; the input's `pattern` is an invalid regex in WebView2 (`/v` flag, console error), so native validation never fires | "Letters, digits, dot, dash, underscore" next to the field, checked before sending | confuses | |
| S2 | Datasets | No screen lists datasets; they exist only as options of the Train dropdown; no split, class counts or delete | Datasets screen (list, stats, delete) | confuses | |
| S3 | Add to dataset, by group, 14 images in 4 groups, fraction 0.2 | Result 8 train / 6 val (43 %), no warning | Warning when the achieved split is far from the requested one, suggestion to use random | confuses | |
| T1 | Train form | 50 epochs, image size 1280, patience 50 with no guidance | One line per field (what it does, sensible range, rough duration) | confuses | |
| T2 | Train on 14 images / result mAP50 0.0 % | Green "Training finished: the model is registered."; no warning before or after | Warning for tiny datasets before start; "this model is unlikely to be useful" when mAP is near zero | confuses | |
| T3 | Train progress | The log is open by default and shows the worker command line and raw JSON lines | Log collapsed; human-readable epoch lines | annoys | |
| Q1 | Query run card "Promote" | One click at the default 0.5 accepted 109 junk boxes as ground truth: no explanation, no confirmation, no undo | Plain wording ("Accept N boxes as labels"), the count before confirming, an undo | confuses | |
| Q2 | Query with a weak model at confidence 0.25 | Either nothing (acceptance run: 0 boxes, empty review queue, no explanation) or junk | When a run ends with 0 boxes: say so and suggest a lower confidence or a better model | confuses | |
| Q3 | Query run finished | History row says "0 boxes" until the screen is revisited; the card says "415 boxes written so far" after the end | Consistent final numbers | confuses | |
| Q4 | Estimate for a local model | "480 requests, estimated $0.00 (at $0.00 per request)" | No cost wording for local models | annoys | |
| Q5 | Query Start | Disabled until Estimate is clicked; only a small grey hint | Start estimates by itself, or the hint is next to the disabled button as a reason | annoys | |
| Q6 | Query, tiling off (ledger S4) | Untiled local runs predict at 1280 while pre-annotation uses 2560; not mentioned | Note in the form | annoys | |
| Q7 | Query image selection | "First N" defaults to all 40 including labeled images; the group is free text; no "all images" | Group dropdown; sensible N; "all images" | annoys | |
| Q8 | Query, cloud provider without a key | "Add the key in Settings." is plain text | Link to Settings | annoys | |
| Q9 | Naming | "Query", "Promote", "Proposal" are internal words | "Detect" / "Accept as labels" or a one-line explanation on the screen | annoys | |
| R1 | Review, empty queue | "0 images waiting" | How proposals get here (pre-annotation, Query) with links | confuses | |
| R2 | Review from a run (ledger S5) | "Showing 40 images from a query run" counts the ids in the URL, not the images that still have proposals | Real count | annoys | |
| M1 | Models -> Import with a wrong path | `no usable weights at 'E:\\nope\\x.pt'` (doubled backslashes) | The path as typed | annoys | |
| M2 | Models table (ledger S5) | Rows are not keyboard-focusable | Tab / Enter work | annoys | |
| M3 | Model detail after an export | "models/v1-coco-m-f10283f7.onnx" (relative, no folder named, nothing to click) | Full path and "Show in folder" | confuses | |
| M4 | Imported COCO model | 80 class names listed; nothing says that only aliased or same-named classes produce proposals (here: truck only) | "1 of 80 classes maps to this project" | confuses | |
| X1 | Settings -> Test provider, failing | Green text: "Failed: ProviderError: anthropic returned 401: Error code: 401 - {'type': 'error', ...}" | Red, "The key was rejected by Anthropic (401)." | confuses | |
| X2 | Every timestamp in the UI | UTC without a label (05:06 when the clock says 08:06) while job logs use local time | Local time everywhere | confuses | |
| H1 | `runs/` (ledger S4) | Old tile caches are never cleaned | Cleanup when a run is deleted or superseded | annoys | |
| H2 | Providers | No live request with a valid key has run here; the invalid-key test did reach Anthropic (401). Acceptance step 7 pending an operator key | Step 7 run once with a real key | pending key | |
| G2 | Results | Reviewed detections cannot leave the app: no export of boxes or counts (per image, flight, class) | CSV / report export | open question for the owner | |

Verified as already fine: the Data Manager refreshes by itself after an import; grid thumbnails
carry a box-count badge; "Train on it" on the finished dataset job pre-selects the dataset; the
model name is suggested; a provider test without a key says "no API key stored"; "0 proposals from
the pre-annotation model" exists (E1/E2 are about what is missing around it).

## Owner ruling (2026-09-19)

Shown to the owner before any fix. Blocking: **N1, N2, G1** and additionally **Q1** (promote
safety), **G2** (results export), **E4** (negative images), **S2** (Datasets screen); in the table
above these four count as *blocks*. G1: bundle `yolo11n/s/m.pt` in the installer. Acceptance step 7:
the owner stores the Anthropic key through the app's Settings screen (Credential Manager); the
driver uses a stored key and leaves it alone.

## Order of work

1. Wave U1, goal owner, test-first, one commit per item: navigation and copy (N1, N2, N3, D1, D2,
   P1, S1, X1, X2, E1, E2, E3, Q1 confirmation, Q3, T1, T2, R1, Q8 and the annoyances that are one-liners).
2. Functional gaps as mini sub-projects with a plan each, one after the other, each merged and
   verified on the real app before the next starts: **G1 starter weights**, **E4 negative images**,
   **S2 Datasets screen**, **G2 results export**, then **Q1 undo of a promotion**, **E6 confidence
   filter**, **N4 project overview**.
3. End of each wave: rebuilt installer, checkpoint 4, acceptance driver, `docs/progress.md`.
