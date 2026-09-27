---
type: adr
date: 2026-09-27
status: accepted
tags: [decision, images, sam, gpu]
related: ["[[2026-09-25-gotcha-dynamically-loaded-routers-need-hiddenimports]]", "[[2026-09-21-gotcha-contract-jobs-need-offline-seams]]"]
---

# Smart polygon keeps its embeddings on the CPU and picks the device per call

## Context

SAM 2.1 tiny (spec 2026-09-26-image-inspection §10) must use the GPU when it is free and the CPU when
training holds it (`jobs/gpu.gpu_lock` is held for a whole training run), without failing a click.
An embedding computed on CUDA is useless to a CPU decoder unless it moves, and Ultralytics'
`SAM2Predictor` keeps device state (`device`, `mean`, `std`, the model) that is awkward to move in
place. I-C0's `SegmentBackend` seam passes the device on every `encode`/`decode` call.

## Decision

- `SegmentService` tries `hold_gpu(timeout=0.2)` per call and asks the backend for `"cuda"` if it
  answers, else `"cpu"`.
- `UltralyticsSam2Backend` holds one predictor, on the device of the last call: a different device
  drops it (and `torch.cuda.empty_cache()` frees its VRAM) and loads one on the new device (≈ 0.6 s).
- `encode` copies the features (≈ 16 MB) to the CPU; `decode` copies them to the requested device, so
  the two cached embeddings survive a device switch and a click after training starts needs no re-encode.
- A CUDA failure falls back to the CPU; only a CPU failure, or the backend module failing to import,
  marks SAM unavailable (`409 assist_model_missing`, `details.state = "unavailable"`).
- `torch.set_num_threads(max(2, cores // 2))` caps CPU threads so the API stays responsive while SAM
  encodes. Ultralytics' own `select_device("cpu")` resets torch's thread count to `min(8, cores - 1)`
  inside `setup_model`, which would silently override a cap set only once — so the backend re-applies
  `max(2, cores // 2)` after *every* CPU predictor load, not just the first.
- `set_num_threads` is process-wide (Deviation 7): capping it for SAM's CPU path also caps in-process
  CPU YOLO inference (BP's `detect_one` CPU path). Training and export run in worker subprocesses and
  are unaffected.

## Consequences

- Clicks never wait for training; the answer says `device: "cpu"`.
- Alternating busy/free GPU costs a reload per switch; acceptable for an interactive tool.
- A CPU click briefly narrows the thread budget available to any concurrent CPU YOLO inference in the
  same process, until the next CPU predictor load re-applies the cap.
- Measured latency: `docs/evidence/images-bs/sam-latency.md`.
