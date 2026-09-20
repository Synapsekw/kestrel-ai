### Task 4: Acceptance script and driver

- [ ] `scripts/acceptance.md`: the eight steps of spec 13.5 with exact UI actions, expected results (3299 images, 0 duplicates, 7 flights `0031, 0033, 0034, 0035, 0038, 0040, 0042`; yolo11m proposals on at least one of 10 images; 30 labeled images; dataset `v1` by_group with train/val folders and a valid `data.yaml`; YOLO11n 3 epochs with progress events and a registered model with metrics; run the trained model over 50 unlabeled images, review, promote; Anthropic query "dump trucks" over 5 images with tiling, boxes with provider provenance; ONNX export under `models/`), and the evidence file name for each.
- [ ] `frontend/scripts/acceptance.mjs`: CDP driver that performs steps 1-8 against the installed app, mixing UI actions (project creation, import via the Import images dialog, labeling 30 images by drawing one box each, dataset creation, training start, query run) with API reads through `backend_info` for assertions; screenshots per step into `docs/evidence/acceptance/`; the Anthropic step requires `ANTHROPIC_API_KEY` in the environment: the driver sets it through the providers key endpoint at runtime and never writes it anywhere; it skips the step with a clear message when the variable is absent. The import of 3299 frames takes a while: poll progress and allow up to 60 minutes.
- [ ] Run it once end to end on the installed app; fix what breaks (in the owning sub-project's files, with tests, or report if it is a contract change); paste the summary in the report.
- [ ] Commit `test: acceptance script and driver`.

---

