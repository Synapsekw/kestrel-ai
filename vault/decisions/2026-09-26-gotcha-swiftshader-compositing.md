---
type: adr
date: 2026-09-26
status: accepted
tags: [decision, gotcha]
related: []
---

# 2026-09-26-gotcha-swiftshader-compositing

## Context

`frontend/e2e/clouds.spec.ts` launched Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader` so that WebGL would work in headless Chromium. On the GitHub `windows-latest` runner (AMD EPYC, 2 cores and 4 logical CPUs) this file failed on `main` in different tests from run to run. The import test, the export test and the right-click test all failed there. Mock and Vite answers took 22 to 33 s, and the page sat on "Loading". Running the file last, alone or on one worker did not help. It passed on the dev machine.

That flag does more than choose a WebGL backend. It moves Chromium's **GPU compositing and raster** onto SwiftShader as well. `SystemInfo.getInfo` shows `gpu_compositing: enabled` and `rasterization: enabled` with SwiftShader as the GL renderer. Without the flag, both read `disabled_software`. Every repaint of the page then runs through a software GPU that uses all cores. CSS animations cause a repaint on every frame, and the app has several: the importing row's shimmer `Progress` and the live `Pill` dot.

Measured on the runner with a probe spec (CDP `SystemInfo.getProcessInfo`, GPU-process CPU time, 100 % = one core, run 36214259362):

| State | `--use-angle=swiftshader` | no flag / `--use-angle=swiftshader-webgl` |
| --- | --- | --- |
| Viewer loading (3 s) | 399 % | 98-101 % |
| Viewer settled, no rAF | 212 % | 35 % |
| Clouds list with an importing row (CSS animations only) | 190 % | 29 % |

WebGL rendered on SwiftShader in every column, with identical colour samples. The runner's headless shell already falls back to SwiftShader for WebGL without any flag. The viewer's own render loop was not the cause: once the view settled it asked for 0 animation frames in 5 s in every variant.

## Decision

`clouds.spec.ts` launches with `--use-angle=swiftshader-webgl --enable-unsafe-swiftshader`. This keeps WebGL pinned to SwiftShader (plan decision 13) and leaves compositing and raster in plain software. Two assertions pin the fix:

- A test reads `SystemInfo.getInfo` and fails when GPU compositing is `enabled` on a SwiftShader renderer. Before the fix it failed on the old flags.
- The render test checks that the viewer asks for no animation frame one second after it settles. It fails when `shouldKeepRendering` never returns false: 87 frames became 148.

## Rationale

- The failure came from the flag, not from test order, timeouts or the app's own loop. The measurements separate these causes, and the ordering and single-worker trials had already ruled out order.
- Retries or longer timeouts would hide a browser that takes all 4 vCPUs.
- Removing the flags altogether also works on this runner. `swiftshader-webgl` keeps WebGL on SwiftShader on a machine whose Chromium would otherwise pick a real GPU or refuse the fallback, and it does not touch the compositor.
- Removing the app's CSS animations under test (`reducedMotion`) was rejected. The animations are cheap in software compositing. Only SwiftShader compositing makes them expensive.

## Consequences

- Positive: clouds.spec on CI costs about the same CPU as a flagless browser, and the rest of the suite is no longer starved beside it.
- Negative: the SystemInfo check relies on Chromium's `featureStatus` and `auxAttributes.glRenderer` names. A Chromium update that renames them makes the check pass without checking anything.
- Open follow-ups: none. Never set `--use-angle=swiftshader` globally in `playwright.config.ts`. That was the original "global flags starve the CPU" symptom from 0af7084, with the same cause.

## Related

- `frontend/e2e/clouds.spec.ts`, `frontend/playwright.config.ts`, `frontend/src/clouds/viewer/idle.ts`
- Commits 0af7084 (flags moved out of the global config), f704142 (viewer waits)
