# I-BS: smart polygon latency (spec 2026-09-26-image-inspection §10, §21 risk 2)

Measured 2026-09-27 with `backend/scripts/measure_sam_latency.py`, SAM 2.1 tiny (`sam2.1_t.pt`, sha256
3c1e81ca…bd4e3), median of 5 encodes and 15 clicks after one warm-up. Machine: Intel Core i7-13700K,
24 logical cores, NVIDIA GeForce RTX 5070 Ti 16 GB. Frame: `IX-12-02491_0031_0001.jpg` (ahmadia).

| Device | Crop (source px) | Threads | Encode ms (target) | Decode ms (target) |
|---|---|---|---|---|
| cuda | 1024 | – | 98 (≤ 150) | 8 (≤ 40) |
| cuda | 2048 | – | 107 (≤ 150) | 8 (≤ 40) |
| cpu | 1024 | 12 | 909 (≤ 3500) | 38 (≤ 300) |
| cpu | 2048 | 12 | 885 (≤ 3500) | 35 (≤ 300) |
| cpu, 8-core budget | 1024 | 4 | 1142 (≤ 3500) | 52 (≤ 300) |
| cpu, 8-core budget | 2048 | 4 | 1307 (≤ 3500) | 49 (≤ 300) |

Encode includes reading and resizing the crop from the JPEG (ruling BS11). The "8-core budget" rows
fake `os.cpu_count() = 8` in a fresh process, so the backend caps torch at 4 threads; they run on
this desktop's cores, so a real 8-core laptop will be slower per thread.

**Load caveat.** The machine was shared with other units running test suites: total CPU load read
34–61 % around the runs (GPU idle, 3.9 GB of 16 GB VRAM in use by others). The CPU figures are
therefore likely pessimistic for this machine; they are recorded, not asserted.

**Thread cap finding.** Ultralytics' `select_device("cpu")` (called inside
`SAM2Predictor.setup_model`) resets torch to `min(8, cores - 1)` threads, which overrode the
backend's half-the-cores cap (first run printed `threads=8` instead of 12). The backend now applies
the cap after every CPU predictor load; the table above is from the fixed code.

Verdict for FA: every target is met with margin — the CPU path encodes in about 0.9 s (1.1–1.3 s at
the 4-thread laptop budget, well under 3.5 s even allowing a laptop core at half this speed) and
decodes a click in under 60 ms; the warm-up edge should expect the first call after an idle unload
to add the model load (≈ 0.6 s, BS6; not part of these medians) on top of one encode. Frozen-build
smoke numbers: filled by IMC-X from `smoke_frozen.ps1`'s `sam ok` line.
