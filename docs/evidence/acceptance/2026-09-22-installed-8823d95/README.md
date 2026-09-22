# Acceptance run on the installed Kestrel AI build, main `8823d95` (2026-09-22)

**Result: 8/8 PASS** (spec 13.5, `scripts/acceptance.md`) on the installed app. This is the first
run on the renamed Kestrel AI build; it replaces the stale 8/8 at `177f68b` and closes Task 11
Step 5 of `docs/superpowers/plans/2026-09-20-kestrel-ai-rename.md`.

## Build

- Source: main `8823d95` (batch A: Select width fix, G3 report labels, Node 24 CI actions,
  portable test paths; plus the editor/train fixes from `afba411`, first time installed).
- Frozen backend 3,520.5 MB in 14,116 files (181 s). `smoke_frozen.ps1`: health, CUDA on the
  RTX 5070 Ti, 3 starters, predict, worker train, font pre-seed, ONNX export; keyring skipped
  because an Anthropic key is stored (not touched). `cargo test`: 8 passed.
- Installer `Kestrel AI_0.1.0_x64-setup.exe` 1,853.3 MB (499 s), kept outside the repo as
  `E:\Dev\Yolo\installers\Kestrel AI_0.1.0_x64-setup-8823d95.exe`.
- Install: silent, exit 0 in 105 s (after an earlier aborted attempt, see below). Installed
  `kestrel-ai.exe` and `kestrel-backend.exe` hashes match the build; every one of the 14,115
  `_internal` files is present at the build's size, and the 40 largest match by hash. 49 stale files
  from the 2026-09-21 install remain (45 `api-ms-win-*` forwarders, 4 runtime `__pycache__`);
  Inno Setup does not delete files a newer build stopped shipping.

## Run

Driver `frontend/scripts/acceptance.mjs --conf 0.001` (as `scripts/acceptance.md` step 6
documents) on a separate instance of the installed exe with its own WebView2 profile and CDP port.
Project `d206fddd-a4dd-43a4-891e-e184d366b8f8` in `E:\tmp\acceptance-8823d95`; `acceptance.json`
is the final pass.

| Step | Result |
|---|---|
| 1 | project with the eight classes (created on the first pass; the final pass resumed it) |
| 2 | 3,299 images, 0 duplicates, 7 flights `0031,0033,0034,0035,0038,0040,0042` |
| 3 | `yolo11m-coco` (80 classes) as pre-annotation model, 4 proposals over 10 images |
| 4 | dataset `v1` by group, train 24 / val 6, frozen images match the 30 labeled ones |
| 5 | `ahmadia-v1`, 3 epochs, registered (mAP50 0.0, as expected for 30 placeholder boxes) |
| 6 | 50 unlabeled images, 60,985 boxes at 0.001, 50 rows in review, promoted |
| 7 | Anthropic "dump trucks" over 5 images, tiling 1280 px, 2 boxes with anthropic provenance, stored key used as is |
| 8 | ONNX export `models/ahmadia-v1-915a045e.onnx` |

Screenshots: `acceptance-0N-*.png`. `acceptance-04-dataset.png` shows the editor, not the dataset
dialog: on the resumed final pass the dataset already existed, so step 4 asserted through the API
and its screenshot caught the screen step 3 left open. The dataset itself is evidenced by
`acceptance-04-data-yaml.txt` and the step 4 assertions.

**G3 on the frozen build:** an HTML report exported from this project (`exports/2026-09-22_174953`)
draws the new filled label tags - `g3-report-thumbnail-installed.jpg` - so Pillow's bundled
FreeType font is in the PyInstaller bundle.

## What went wrong on the way (recorded, not hidden)

- The first silent install exited 5: the app was reopened mid-install and Setup aborted on files in
  use; a clean reinstall with no instance running exited 0.
- The operator worked in the driver's window (it looks exactly like the app). They opened their own
  project and step 3 imported a duplicate `yolo11m-coco` into it and set it as that project's
  pre-annotation model. Repaired with the operator's consent (pre-annotation back to none, the
  duplicate deleted; no boxes or runs came from it). The driver now stops if its window leaves the
  run's project and shows a banner (`22e0c30`).
- The driver's window was closed twice mid-run, once during step 7 after 38 successful Anthropic
  tile calls. The final pass ran with the operator's instance closed.
- One pass omitted `--conf 0.001` and step 6 found nothing, as the runbook predicts.

ADR: `vault/decisions/2026-09-22-gotcha-acceptance-window-looks-like-the-operators-app.md`.
