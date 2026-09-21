---
type: adr
date: 2026-09-21
status: accepted
tags: [decision, gotcha]
related: ["[[2026-09-20-gotcha-cargo-test-needs-the-frozen-sidecar]]", "[[2026-09-21-gotcha-concurrent-gate-runs-may-starve-the-job-runner]]", "[[2026-09-21-2139-ci-green]]"]
---

# CI ran checks the local gate did not, and hid failures behind one another

## Context

Every GitHub Actions run of `ci` on `Synapsekw/kestrel-ai` had failed since the repo was published:
14 of 14 push runs from 2026-09-20 11:49 to 2026-09-21 16:27 (`gh run list`). Every one of those
merges had passed the local gate in `scripts/finish-task.ps1`. Four separate causes were stacked,
and each one hid the next because a failed step skips the steps after it:

1. **`ruff format --check`.** CI runs `ruff check . && ruff format --check .`; the local gate
   (`AGENTS.md`, `CONTRIBUTING.md`, `finish-task.ps1`) ran only `ruff check`. 12, then 15, then 19
   files drifted. Same ruff (0.16.8) on both sides, so this was not a version skew. It also meant
   **pytest had never run on CI**.
2. **Machine-local test input.** Once formatting passed, pytest ran for the first time and
   `tests/test_registry.py` errored three times: it imported `E:/Dev/Yolo/models/yolo11n.pt`,
   which exists only on the reference machine.
3. **The local gate had no e2e step**, so Playwright only ever ran on the runner, and two editor
   races only showed there. `review.spec.ts` timed out on every run: the `a` key was pressed and no
   `POST /boxes/review` followed. `editor.spec.ts` (`R rejects…`) failed the same way on some runs.
   - *Race 1, proven:* `useEditorHotkeys` re-registered its document listener in a passive
     `useEffect`, which React runs a task after the commit. A key landing in that gap reached the
     stale `enabled: false` handler. An 8x CPU throttle (`Emulation.setCPUThrottlingRate`)
     reproduced it 8/8; a `useLayoutEffect` passed 8/8.
   - *Race 2, proven:* `useEditorImage` reported `loading` from a `useState` update, but the image
     and boxes render from zustand (`useSyncExternalStore`), which commits synchronously. React
     committed the `useState` update a task later, so one commit showed the image and "1 suggestion"
     with `loading` still `true` and the hotkeys disabled. A render-by-render unit test
     (`useEditorImage.test.tsx`, "never commits the loaded image while still reporting loading")
     caught that commit every time. After race 1's fix, CI still failed on it once in four runs.
4. **`sidecar-smoke`** runs only on `workflow_dispatch`, so it had never run. `build.ps1` needs
   the starter weights. `fetch_starter_weights.ps1` then died on the runner because `Join-Path`
   throws on a drive that does not exist (`E:`), and the health probe slept a fixed 10 s.

Smaller finds: `getByRole("heading", { name: "Models" })` also matched the later-loading
"Starter models" heading (substring match), and two e2e specs rewrote tracked PNGs under
`docs/evidence/setup-agent/` on every run. Once pytest ran on CI,
`test_trainer_launch.py::test_train_reports_progress_and_returns_artifacts` failed once in six
runs. The trainer reports the *latest* epoch on each 50 ms poll, and the fake worker's epochs are
also 50 ms, so a slow runner skipped epoch 2. Skipping is by design (progress, not a log), so the
test now asserts only what the design promises: epochs move forward and the last one is reported.
The first CI failure with a trace was `train.spec.ts`, where "Give the model a name." never
appeared. The trace showed `POST /models/train` right after `fill("")`. `TrainForm`'s fill-in effect
treated an empty name as untouched, so the next dataset/model refetch (new arrays, same content)
put the suggestion back. That is a real form bug, not only a test race: a user who cleared the
name had it silently refilled.

## Decision

- **The local gate mirrors CI.** `finish-task.ps1` and the gate text in `AGENTS.md` and
  `CONTRIBUTING.md` now run `ruff format --check .` and `pnpm -C frontend e2e`. The gate picks two
  free ports so `reuseExistingServer` never tests another checkout's dev server. If CI gains a
  step, the gate gains it in the same change.
- **Tests never read a path only one machine has.** `test_registry.py` resolves `yolo11n.pt` from
  the operator folder, then `backend/starter_weights/`, and skips without either. CI fetches the
  pinned-SHA weights (cached) for pytest and for the sidecar build.
- **Anything that gates input on "loaded" follows the same store that renders the loaded view**,
  and swaps listeners in `useLayoutEffect`. React state updated in the same callback as a zustand
  store is *not* committed in the same render.
- **CI keeps evidence of a failure.** `trace: retain-on-failure` under `CI`, plus an
  `upload-artifact` step (`playwright-results`). The runner is the only machine where some races
  show, and without a trace the only clue is a timeout.
- Evidence screenshots write to `test-results/` unless `E2E_CAPTURE_EVIDENCE=1`.

## Rationale

A gate that is a subset of CI makes CI red by construction. It had also been red long enough that
nobody read it, which is how four causes piled up. Each was cheap to fix, but only after the one
in front of it was fixed. Raising timeouts or adding Playwright retries was rejected: both races
were real app behaviour, since a user's key press is dropped the same way on a slow laptop. A retry
would have painted the badge green and kept the bug.

## Consequences

**Positive**

- A merge that passes `finish-task.ps1` now runs every check CI runs, apart from `sidecar-smoke`,
  which only runs on dispatch.
- Two real input-dropping bugs in the editor and one in the train form are fixed, each with a
  regression test that fails without its fix: the throttled `editor.spec.ts` test, the
  render-by-render `useEditorImage` test, and the `TrainForm` "cleared name" test.

**Negative**

- The gate is about a minute longer (e2e is ~40–50 s here) and needs Playwright's Chromium
  (`pnpm -C frontend exec playwright install chromium`).
- CI downloads ~70 MB of weights on a cache miss.

**Open follow-ups**

- `sidecar-smoke` still runs only on dispatch. Dispatch it after packaging changes.
- `test_inference_gpu.py` and `test_training_gpu.py` still hardcode `E:/Dev/Yolo/models`. They
  are GPU-marked and deselected, so they are harmless on CI but not portable.
- GitHub warns that `actions/checkout@v4`, `setup-node@v4`, `pnpm/action-setup@v4` and
  `setup-uv@v6` target Node 20 and are being forced onto Node 24.

## Related

- [[2026-09-20-gotcha-cargo-test-needs-the-frozen-sidecar]] (the other gate step that depends on
  what the machine has)
- [[2026-09-21-gotcha-concurrent-gate-runs-may-starve-the-job-runner]]
- [[2026-09-21-2139-ci-green]]
