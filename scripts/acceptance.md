# Acceptance run (spec 13.5)

The acceptance run is performed **on the installed app** (`Machinery Detection` from the Inno
Setup installer, `pnpm build:installer`), not on a dev build. Every step below names the exact UI
action, what to expect, and the evidence file it produces under `docs/evidence/acceptance/`.

`frontend/scripts/acceptance.mjs` performs all eight steps automatically over CDP; this document
is the source of truth for what "passing" means and is what a person follows when driving by hand.

## Preparation

1. Install the app (`Machinery Detection_0.1.0_x64-setup.exe`, per-user install, no admin needed).
   It writes `machinery-app.exe`, `machinery-backend.exe` and the sidecar's `_internal/` folder
   into `%LOCALAPPDATA%\Programs\Machinery Detection`; those three stay together.
2. Launch it with the WebView2 debugging port so the driver can attach:

   ```powershell
   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
   Start-Process "$env:LOCALAPPDATA\Programs\Machinery Detection\machinery-app.exe"
   ```

3. Choose an empty project folder on a disk with room for 3299 imported frames (about 20 GB).
4. For step 7, either leave the Anthropic key that is already in Credential Manager (the driver
   uses it and does not touch it) or put one in the environment of the shell that runs the driver
   (`$env:ANTHROPIC_API_KEY`). A key from the environment is stored through
   `PUT /providers/anthropic/key` for the run and deleted again afterwards; it is never written to
   a file, a log or a commit. With neither, the step is skipped with a clear message and the run
   still passes.
5. Run the driver:

   ```powershell
   node frontend\scripts\acceptance.mjs --project-folder E:\tmp\acceptance --evidence docs\evidence\acceptance
   ```

   The defaults are the real acceptance values; `--source`, `--expect-images`, `--expect-flights`,
   `--preannotate-images`, `--min-proposals`, `--label-count`, `--epochs`, `--imgsz`, `--batch`,
   `--query-images`, `--min-query-boxes`, `--cloud-images` and `--min-cloud-boxes` parametrise it
   for a dry run on a small copy of the frames. `--project-id` resumes a run whose import is done.

## Steps

### 1. Create project "Ahmadia" with the eight classes

- **UI**: Projects screen -> `Name` = `Ahmadia`, `Folder` = the chosen folder -> **Create project**.
- **Expect**: the app navigates to the project's Data Manager; `GET /projects/{id}` reports the
  eight default classes `excavator, wheel_loader, bulldozer, dump_truck, crane, concrete_mixer,
  roller, backhoe` with hotkeys 1-8.
- **Evidence**: `acceptance-01-project.png`

### 2. Import `E:\Dev\Yolo\Ahmadia Construction Data`

- **UI**: Data Manager -> **Import images** -> `Folder` = `E:\Dev\Yolo\Ahmadia Construction Data`,
  `Site name` = `ahmadia` -> **Start import**. The source folder is only ever read.
- **Expect**: the import job succeeds (allow up to 60 minutes); `GET /stats` reports
  `image_count` **3299**, `duplicate_count` **0** and **7** flight groups
  `0031, 0033, 0034, 0035, 0038, 0040, 0042`.
- **Evidence**: `acceptance-02-import.png`

### 3. Pre-annotation model and proposals on 10 images

- **UI**: Models -> **Import weights** -> `Model name` = `yolo11m-coco`,
  `Weights path` = `E:\Dev\Yolo\models\yolo11m.pt` -> **Import** -> **Use as pre-annotation
  model**. Then open the first 10 images in the editor one after another; pre-annotation runs on
  open.
- **Expect**: the model is registered with 80 COCO class names and is the project's
  `preannotation_model_id`; at least one of the 10 images carries a box with provenance
  `local_model`.
- **Evidence**: `acceptance-03-preannotation.png`

### 4. Label 30 images and freeze dataset "v1"

- **UI**: for each of 30 images, open the editor, press hotkey `1` (excavator) and drag one box on
  the canvas. Then Data Manager -> `Labeled` = `yes` -> **List** -> wait until the filter bar reads
  the labeled total -> select the 30 rows (click the first, shift-click the last) -> **Add to
  dataset** -> `Dataset name` = `v1` -> **Create dataset** (split method `by_group`, the dialog's
  default).
- **Expect**: `GET /stats` reports `labeled_count` >= 30; the dataset job succeeds; the dataset
  is named `v1` with `split_method` `by_group` and `train_count + val_count` == 30, both above
  zero; on disk `datasets/v1/images/train`, `datasets/v1/images/val`, `datasets/v1/labels/train`
  and `datasets/v1/labels/val` exist, and `datasets/v1/data.yaml` lists `path`, `train`, `val`
  and all eight class names; the images frozen into the dataset folder are exactly the 30 labeled
  ones.
- **Evidence**: `acceptance-04-dataset.png`, `acceptance-04-data-yaml.txt`

### 5. Train YOLO11n for 3 epochs

- **UI**: the base model for this run is YOLO11n, so import `E:\Dev\Yolo\models\yolo11n.pt` on the
  Models screen as `yolo11n-coco` first (**Import weights**, same dialog as step 3). Then Train ->
  `Dataset` = `v1`, `Base model` = `yolo11n-coco`, `Model name` = `ahmadia-v1`, `Epochs` = `3`,
  `Image size` = `1280`, `Automatic batch size` off, `Batch size` = `4` -> **Start training**.
- **Expect**: the Train screen shows a live epoch card; the job reaches `succeeded`; at least one
  `job.progress` event per epoch - 3 for this run - arrives on the `/api/v1/events` websocket for
  the training job; the resulting model is registered with `kind: trained` and numeric `metrics`
  (`map50`, `map50_95`, `precision`, `recall`).
- **Evidence**: `acceptance-05-training.png`

### 6. Query run over 50 unlabeled images, review and promote

- **UI**: Data Manager -> `Labeled` = `no` -> **List** -> wait until the filter bar reads the
  unlabeled total -> select the first 50 rows (click the first, shift-click the last) -> **Run
  model**. On the Query screen `Model` = `ahmadia-v1`,
  `Confidence` = `0.25` -> **Estimate** -> **Start**. **Review** when it finishes: follow
  **Review results** on the run card, which opens the Review queue narrowed to the run's images
  (that queue is where a person opens each image and accepts or rejects the proposals with A and
  R). Then back on the run card set `Minimum confidence` = `0` and press **Promote**.
- **Expect**: the inference job succeeds over exactly the 50 unlabeled images that were selected
  (`run.image_ids` is that set, not just 50 of anything) and writes at least one box; the Review
  queue lists the run's images; after promotion `GET /query-runs/{id}` has a non-null
  `promoted_at` and the promoted boxes carry provenance `local_model` with the run's model id.
- **Evidence**: `acceptance-06-query-run.png`, `acceptance-06-review.png`,
  `acceptance-06-promoted.png`

### 7. Anthropic vision query "dump trucks" over 5 images with tiling

- **UI**: Query -> tick `Cloud provider`, `Query` = `dump trucks`, `Tiling` on, 5 images ->
  **Estimate** -> **Start**.
- **Expect**: the job succeeds over exactly 5 images with tiling enabled, and at least one box the
  run wrote carries provenance kind `cloud_provider` with `provider: anthropic`. A key that was
  already in Credential Manager is used as it is and left alone; a key this run stored from the
  environment is removed again afterwards, including when the step fails.
- **Skipped** with `SKIP 7. anthropic vision query (no ANTHROPIC_API_KEY)` when neither a stored
  key nor the environment variable is there.
- **Evidence**: `acceptance-07-cloud-run.png`

### 8. Export the trained model to ONNX

- **UI**: Models -> `ahmadia-v1` -> **Export ONNX**.
- **Expect**: the export job succeeds and `models/<model>.onnx` exists inside the project folder
  with a non-zero size.
- **Evidence**: `acceptance-08-export.png`

## Result

The driver writes `docs/evidence/acceptance/acceptance.json` with, per step, the name, pass/fail,
the measured values and the elapsed seconds, plus the list of skipped steps; it is written even
when a step fails, with `failed_step` and the error. A run passes when every step is `ok` and the
only skips are ones this document allows.
