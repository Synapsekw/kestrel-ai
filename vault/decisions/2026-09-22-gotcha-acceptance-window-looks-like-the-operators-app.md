---
type: adr
date: 2026-09-22
status: accepted
tags: [decision, gotcha, acceptance]
related: ["[[2026-09-21-gotcha-native-icon-verification]]"]
---

# The acceptance window looks exactly like the operator's app

## Context

On 2026-09-22 the acceptance run was started on a second instance of the installed app (its own
WebView2 profile, `--remote-debugging-port=9222`) while the operator kept working. Three things
went wrong in one afternoon:

1. The first install aborted with Inno exit code 5: the operator reopened the app mid-install and
   Setup, in silent mode, answered its "close applications" prompt with Abort. Inno's rollback does
   not restore files it already replaced, so the tree may be mixed until a clean reinstall.
2. The only window on screen was the driver's. The operator used it, opened their own project, and
   step 3's UI actions landed there: a duplicate `yolo11m-coco` was imported into their project and
   its pre-annotation model was switched from none to that duplicate. The driver asserted only
   through the API against its own project id, so it never noticed. Repaired by hand
   (`PATCH preannotation_model_id: null`, `DELETE` of the duplicate); no boxes or runs came from it.
3. The driver's window was later closed twice while it was running (once mid-way through the
   step 7 Anthropic run, after 38 paid tile calls). Closing a Tauri window kills its sidecar with
   no shutdown line in `sidecar.log`, which both instances share.

## Decision

- `acceptance.mjs` arms a guard once the run's project is known: any navigation of its window to a
  path outside `/p/<run project>` writes `acceptance.json` and exits 3 before the next click, and
  the window carries a red "Acceptance run in progress - do not use this window" banner that does
  not intercept clicks. Proven by navigating a resumed run to a made-up project id.
- Run acceptance with the app to itself: the operator closes their instance first. Side-by-side is
  possible but not worth it; the GPU and the shared log are contended anyway.
- Install only with no instance running, and check the Inno exit code, not just executable hashes.
- Pass `--conf 0.001` for a real run (documented in `scripts/acceptance.md` step 6); without it a
  3-epoch model on 30 placeholder labels finds nothing and step 6 fails.

## Consequences

- Positive: a hijacked window can no longer write into another project.
- Negative: the guard stops the run rather than recovering; a resumed run (`--project-id`) picks up.
- Inno Setup leaves files a newer build no longer ships (45 `api-ms-win-*` forwarders and runtime
  `__pycache__` from the 2026-09-21 install remained in `_internal/`). Harmless on Windows 11;
  worth an `[InstallDelete]` for `{app}\_internal` if a stale file ever shadows a new one.

## Related

- `scripts/acceptance.md`, `frontend/scripts/acceptance.mjs`
