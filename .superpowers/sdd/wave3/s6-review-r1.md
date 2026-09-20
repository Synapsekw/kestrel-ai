# S6 review round 1: Task 3 installer (`b96c6d9`) + fix round 1 (`6cdd435`)

Range `02359a9..6cdd435`. Everything below was checked against the worktree
`E:\Dev\Yolo\app\.worktrees\s6-packaging-acceptance`, the vendored crate sources
(`tauri-build 2.6.3`, `tauri-plugin-shell 2.3.6`) and the contract - not against the report.
No builds were run and the setup exe was not executed. M9 and M11 are deferred and not re-raised.

---

## A. Installer spec compliance - ✅

Measured against the goal-owner ruling (decision 13), which supersedes the Task 3 brief on format.

| Ruling item | Status | Where |
|---|---|---|
| Inno Setup 6 compiled by the `innosetup-compiler` npm devDependency inside `frontend/node_modules`, no system install | ✅ present | `frontend/package.json:44` (`innosetup-compiler ^6.3.1`), `frontend/pnpm-lock.yaml`; `frontend/scripts/build-installer.ps1:39-42` resolves `node_modules\innosetup-compiler\bin\ISCC.exe` and fails with a `pnpm install` hint when absent. It is a direct dependency, so pnpm's isolated store still symlinks it at that path. |
| Wraps `pnpm tauri build --no-bundle` output | ✅ present | `build-installer.ps1:47-55`, `:57-58` (post-condition on `target\release\machinery-app.exe`) |
| Per-user install: `PrivilegesRequired=lowest`, `{localappdata}\Programs\Machinery Detection` | ✅ present | `frontend/installer/machinery-detection.iss:33-34`. `{autoprograms}` at `:62` therefore resolves to `{userprograms}`. |
| LZMA2 | ✅ present | `machinery-detection.iss:41-42` (`Compression=lzma2/max`, `SolidCompression=yes`) |
| App exe + sidecar exe + `_internal` | ✅ present | `machinery-detection.iss:54-56`; `_internal` with `recursesubdirs createallsubdirs` |
| Start Menu shortcut | ✅ present | `machinery-detection.iss:61-62` |
| Uninstaller removes the install dir only, app data stays | ✅ present | `machinery-detection.iss:70-74` (`[UninstallDelete] Type: filesandordirs; Name: "{app}"`). Nothing touches `%APPDATA%\ai.synapse-solutions.machinery-app` or project folders. |
| x64 only | ✅ present (see A4) | `machinery-detection.iss:37-38` (`x64compatible`) |
| No license page | ✅ present | no `LicenseFile` / `[Licenses]` anywhere in the .iss |
| WebView2 bootstrapper run only when the runtime is absent, and only when the file exists at build time | ✅ present | `machinery-detection.iss:24` (`HaveWebView2Setup`), `:57-59` and `:64-68` behind `#if`, `Check: NeedsWebView2` backed by `:76-99` (HKLM\WOW6432Node, HKLM, HKCU `EdgeUpdate\Clients\{F3017226-...}` `pv`, rejecting `''` and `0.0.0.0`). Both HKLM probes are covered regardless of which registry view Inno gives `HKEY_LOCAL_MACHINE`, because the 32-bit view of `SOFTWARE\Microsoft\...` *is* `SOFTWARE\WOW6432Node\Microsoft\...`. |
| Version read from `tauri.conf.json` | ✅ present | `build-installer.ps1:44` -> `/DAppVersion=` at `:85`; `machinery-detection.iss:12-14, 29, 31, 40` |
| Output `Machinery Detection_<version>_x64-setup.exe` under `.../target/release/bundle/inno/` | ✅ present | `machinery-detection.iss:20, 39-40`; verified again by the script at `build-installer.ps1:91-92` |
| Implementer must not run the setup exe | ✅ | report says so; nothing in the diff invokes it |
| `pnpm build:installer` entry point | ✅ present | `frontend/package.json:14` |
| README + `scripts/acceptance.md` install instructions rewritten | ⚠ changed, one stale line | `README.md:117-136, 138-152, 193-206`; `scripts/acceptance.md:3, 12-17`. See **A1**. |
| `docs/progress.md` packaging evidence: numbers present, "open decision" paragraph replaced | ✅ present | `docs/progress.md:161-162` (installed-layout probe; **1,797.3 MB in 377 s**, ISCC 352.3 s), `:174-186` ("Resolved by decision 13", then what is still the goal owner's). The three-option "Open decision for the goal owner" block is gone. |
| Nothing writes outside the repo or temp, no binary committed, no secret | ✅ | `git diff --numstat 02359a9..6cdd435` has no binary files; `.gitignore:16` ignores `frontend/installer/MicrosoftEdgeWebview2Setup.exe`; the only writes are `frontend/installer/` and `target/release/bundle/inno/` (both gitignored) and `$env:TEMP` in the smoke script. No credential material in the diff. |

### Sidecar-name claim: verified correct

`sidecar.rs:56` calls `.sidecar("machinery-backend")`. In `tauri-plugin-shell 2.3.6`,
`relative_command_path` (`src/process/mod.rs:120-152`) joins the command onto
`current_exe().parent()` and appends `.exe` on Windows - i.e. `<exe dir>\machinery-backend.exe`,
with no target triple. The .iss renames on the way in
(`machinery-detection.iss:55`, `DestName: "machinery-backend.exe"`), so the installed layout
matches what the Rust code resolves. In dev the same name is produced by `tauri-build`:
`copy_binaries` strips the triple from `bundle.externalBin` (`tauri-build/src/lib.rs:545-552`) and
`copy_resources` (`:567-572`) stages the `resources` map, so `target/{debug,release}` already
contain `machinery-app.exe` + `machinery-backend.exe` + `_internal/` - which is exactly the tree the
implementer copied to a temp folder and launched. The claim and the evidence hold.

### `bundle.targets: []` - does not break `--no-bundle` or dev

`tauri.conf.json:28-42`. Verified from the vendored sources rather than by building:

- The config schema (`frontend/node_modules/@tauri-apps/cli/config.schema.json`, `BundleTarget`)
  accepts an empty array.
- `copy_binaries` / `copy_resources` run unconditionally in `tauri_build::build()` and are not
  gated on `bundle.targets` or on dev/release, so `pnpm tauri dev` still gets its sidecar and
  `_internal`.
- The Windows exe icon is taken from the first `bundle.icon` entry ending in `.ico`
  (`tauri-build/src/lib.rs:608-669`), which is still listed (`tauri.conf.json:36`) and exists
  (`frontend/src-tauri/icons/icon.ico`). Version info likewise comes from the config, not the
  bundler. So the exe keeps its icon and resources.
- Dropping `bundle.windows.webviewInstallMode` / `nsis.installMode` is dead config now; nothing
  reads it without a bundler target.

Consequence worth knowing: a bare `pnpm tauri build` now silently produces no installer. README
lines 117-136 document `pnpm build:installer` as the way, which covers it.

### PowerShell 5.1 review of `build-installer.ps1` - clean on the classic traps

Verified rather than assumed: no `&&` anywhere; native stderr is merged with `2>&1` only after
dropping to `$ErrorActionPreference = "Continue"` and each line is re-stringified with `"$_"`
(`:50-51`, `:84-86`), so PS 5.1's NativeCommandError wrapping cannot abort the build; `$LASTEXITCODE`
is captured on the line right after the native call and before the preference is restored
(`:52-54`, `:87-89`); every path is passed as a variable or an array element, never interpolated
into a command string, so spaces are safe; `throw` under `powershell -File` exits 1, and the script
adds a post-condition (`:92`) so a "successful" ISCC that produced nothing is still a failure.
`$PSScriptRoot` is only used in the body, matching the comment at `:26-28`.

## A. Installer quality findings

**A1. Important - `README.md:145` still names the wrong installed sidecar.**
`README.md:145`: "The app installs next to the sidecar: `machinery-backend-x86_64-pc-windows-msvc.exe`
with its `_internal/` folder beside it." The installer writes `machinery-backend.exe`
(`machinery-detection.iss:55`), which is the whole point of the `DestName` rename and of the layout
probe the implementer ran. Scenario: an operator (or the goal owner during checkpoint 4) whose app
will not start opens `%LOCALAPPDATA%\Programs\Machinery Detection`, sees no file with the name the
README promises, and concludes the install is broken - or worse, renames the file back to the triple
form "to match the docs", after which `sidecar("machinery-backend")` can no longer resolve it and
the app is genuinely broken. This line is also the last remnant of the pre-Inno text, so M14 is only
partly done.
Fix: `machinery-backend.exe` in `README.md:145`, and add the one-line reason (the shell plugin
resolves `<exe dir>\<name>.exe`).

**A2. Minor - two sources of truth for the payload, and no freshness check.**
`tauri build` already stages a correct install tree in `src-tauri/target/release` (sidecar renamed,
`_internal` copied), but the .iss sources from `src-tauri/binaries` instead
(`machinery-detection.iss:17-18`) and re-does the rename. `build-installer.ps1:35-37` only checks
that the two paths *exist*. Scenario: `backend\scripts\build.ps1` fails half-way, or an old freeze is
left in the slot; the script is happy and ships a 1.8 GB installer around stale bits that the frozen
smoke test never saw. Fix: either source from `target\release` (single source of truth, no
`DestName` needed) or compare the sidecar's mtime against `backend\dist\machinery-backend` and warn.

**A3. Minor - the destination page is enabled while uninstall deletes `{app}` wholesale.**
`machinery-detection.iss:34` sets a default dir but nothing disables the "Select Destination
Location" page, and `:70-74` deletes `{app}` recursively on uninstall. An operator who redirects the
install into an existing folder loses that folder's other contents at uninstall time. The ruling
fixes the install location, so pin it: add `DisableDirPage=yes` (and keep `UsePreviousAppDir`).

**A4. Minor - `x64compatible` is broader than "x64 only".**
`machinery-detection.iss:37-38`. `x64compatible` also matches ARM64 Windows, which runs x64 code
under emulation - where the CUDA sidecar cannot possibly work, so the install would succeed and the
app would fail at the first `torch` import. `x64os` is the value that means "x64 only".

**A5. Minor - the build mutates the source tree as a side effect.**
`build-installer.ps1:66-78` copies `MicrosoftEdgeWebview2Setup.exe` out of `%LOCALAPPDATA%\tauri`
into `frontend/installer/`. It is gitignored (`.gitignore:16`), so nothing leaks, but a build step
that deposits a Microsoft redistributable into the working tree is surprising, the copy is never
refreshed once present (a stale bootstrapper is shipped forever), and its provenance is not checked.
Fix: copy into `$env:TEMP` and reference that path with an ISCC `/D`, or at least log the source
path and the file version.

**A6. Minor - "no WebView2 step" is only a warning.**
`build-installer.ps1:76` warns and the build still reports success, and the final summary line
(`:94`) does not mention it. The installer that shipped from this branch therefore has no WebView2
handling at all and nothing in the artefact says so. Add the fact to the summary line, or a
`-RequireWebView2` switch for release builds.

**A7. Minor - `VersionInfoVersion` will fail the compile on a non-numeric version.**
`machinery-detection.iss:31` feeds `{#AppVersion}` straight into `VersionInfoVersion`, which Inno
requires to be numeric. A `tauri.conf.json` version of `0.2.0-rc1` breaks the build with an ISCC
error instead of a clear message. Validate `$version` in `build-installer.ps1:44` or set
`VersionInfoVersion` from a numeric-only prefix.

**A8. Minor - `smoke_frozen.ps1` now deletes a caller-supplied directory by default.**
`backend/scripts/smoke_frozen.ps1:236-241`: the default is a fresh `$env:TEMP` folder, but `-WorkDir`
is a parameter, and passing an existing folder now gets it removed recursively unless `-Keep` is
passed. The message at `:240` also prints "work dir removed" even when
`-ErrorAction SilentlyContinue` swallowed a failure. Delete only when `$WorkDir` was the generated
default, and report the actual outcome.

---

## B. Round-1 findings status

| # | Status | Evidence in the diff |
|---|---|---|
| **C1** virtualised table: cannot tick 30/50 rows | **Addressed** (see N1, N2) | `acceptance.mjs:256-298`. `revealRow` (`:266-277`) scrolls `[data-testid="image-table"]` - which really is the scrolling element (`ImageTable.tsx:72-79`, `overflow-auto` + `containerRef`) - to `index * 36` in a retry loop, matching `ROW_HEIGHT = 36` (`ImageTable.tsx:6`, mirrored at `acceptance.mjs:71`). `selectRows` (`:287-298`) gates on `[role="grid"]`'s `aria-rowcount` (`ImageTable.tsx:46`), clicks row 0 then shift-clicks row `count-1`. The semantics match `selection.ts:9-26`: a plain click sets `{selected:{id}, anchor:id}`, a shift-click takes `ids.slice(lo, hi+1)` inclusive, so 30/50 rows really are reached with only two rows mounted. Row clicks land on the row `div` (`ImageTable.tsx:87-96`); the cells render plain text (`listModel.ts:126-156`), so nothing swallows the click. |
| C1 - does it depend on a filter state the driver sets? | **Yes, and the driver sets it** | Step 4 sets `Labeled = yes` (`acceptance.mjs:427`) then `selectRows` (`:431`); step 6 sets `Labeled = no` (`:536`) then `selectRows` (`:543`). The UI's default sort is `path`/`asc` (`listModel.ts:40`) and the driver queries `sort=path` (`:429`, `:538-541`), so UI index order matches the API order it slices. The page size is 200 (`api/images.ts:9`), so 50 rows are in the first page for the real 3299-frame run. What is *not* checked is that the list on screen is already the filtered one - see **N1**. |
| **I1** step 3 read boxes before pre-annotation ran | **Addressed** | `acceptance.mjs:206-217`. `page.waitForResponse` is created **before** `openEditor` navigates (`:209-214` then `:214`), so the response cannot be missed; the predicate pins the image id (`/images/${imageId}/preannotate`), so a neighbouring image's call cannot satisfy it; bounded at 300 s. The skip condition (`:208`, any `review_state === "unreviewed"`) mirrors `useEditorImage.ts:36-37` exactly. Boxes are read only after the response, and the backend writes them before responding (`inference`/preannotate path). |
| **I2** step 7 destroyed an operator's stored key | **Addressed** | `acceptance.mjs:593-597`: `GET /providers` -> `items.find(p => p.name === "anthropic").has_key`, which the backend really returns (`providers/schemas.py:12-14`, `providers/router.py:29-32`). `PUT` only under `if (!alreadyStored)` (`:598-600`) and the `finally` `DELETE` is likewise guarded (`:636`). No PUT and no DELETE when a key is stored; DELETE in a `finally` only for a key this run stored. |
| **I3** step 7 did not assert provider provenance | **Addressed** | `acceptance.mjs:310-317` (`runBoxes` over `run.image_ids`, filtered on `provenance.query_run_id === run.id`) and `:626-631`: at least `--min-cloud-boxes` (default 1) boxes with `kind === "cloud_provider" && provider === "anthropic"`. `query_run_id` is a real Provenance field (`contract/openapi.yaml:1424-1431`) and the inference job writes it (`backend/app/inference/jobs.py:150-154`), so the filter is sound. `scripts/acceptance.md:110-114` matches. |
| **I4** md vs driver on step 5; no websocket | **Addressed** | `acceptance.mjs:158-176` opens a real `ws://.../api/v1/events?token=` socket and **awaits the `open` event** before returning; `:481` calls it before `openScreen("Train", ...)` and the form is filled afterwards (`:483-503`), so the subscription is live before training starts. Query-string auth is the contract's documented scheme (`contract/openapi.yaml:26-33`) and `job_id` is a real Event field (`:1991-1998`), so the filter at `:506-508` works. The assertion is `progressEvents.length >= cfg.epochs` (`:524`) and `scripts/acceptance.md:80-87` now says the same thing. Assertion strength: adequate but slightly looser than the md's wording - see **N5**. |
| **M1** split method + class names in `data.yaml` | Addressed | `acceptance.mjs:454`, `:461` (`CLASS_NAMES.every(...)`) |
| **M2** `Boolean(metrics)` too weak | Addressed | `acceptance.mjs:522-523` (`typeof map50 === "number"`, `typeof map50_95 === "number"`). `precision`/`recall` are still only promised in the md, not asserted - cosmetic. |
| **M3** no JSON evidence for a failed run | **Partially addressed** | `acceptance.mjs:662-675`: the write moved into a `finally` with `error` and `failed_step` ✅, but `failed_step` is computed as "the last step pushed" (`:664`), and `step()` pushes only on a *completed* assertion. A throw from anywhere else (a `selectRows` timeout, a failed job) therefore records the name of the previous **passing** step. See **N3**. |
| **M4** md text issues | Addressed | `scripts/acceptance.md:104` now lists `acceptance-06-review.png`; step 5's UI line rewritten (`:70-76`); the skip line (`:115-116`) matches the driver's exact string at `acceptance.mjs:639` |
| **M5** vacuous "review"/promotion | Addressed | `scripts/acceptance.md:94-103` defines what reviewing means; `acceptance.mjs:583` asserts `run.box_count >= cfg.minQueryBoxes` (default 1). The `reviewRows` number is evidence only - see **N6**. |
| **M6** 422 body could echo the key | Addressed | `acceptance.mjs:107-118` (`redact`), used for the key PUT at `:599` only |
| **M7** `YOLO_CONFIG_DIR` leaked out of tests | Addressed | `tests/test_ultralytics_env.py:40, 55, 58, 70` use `monkeypatch.setenv("YOLO_CONFIG_DIR", "")`, and `fonts.py:49-52` treats an empty value as unset (`if existing:`), so the variable is genuinely restored |
| **M8** real CUDA probe in every test app | Addressed | `tests/conftest.py:37-46` installs `GpuProbe(probe=lambda: ...)` on `created.state.gpu_probe`, which is exactly what the route reads (`app/health.py:85`), so no torch import in the pytest process; one real-probe test kept (`tests/test_health.py:81-88`, `probe_cuda()` directly) |
| **M10** smoke work dir never removed | Addressed (see A8) | `smoke_frozen.ps1:265` (`-Keep`), `:236-241` |
| **M12** a failing sweep blocked opening a project | Addressed | `backend/app/projects/service.py:152-156` (try/except + `log.exception`), test `tests/test_job_startup.py:87-99` asserts the project still opens and that the message reaches `caplog` |
| **M13** misleading `console=False` comment | Addressed | `backend/machinery_backend.spec:62-66` now cites the smoke script's redirected-stdout parse |
| **M14** README gave `/S` and `msiexec` for a non-existent installer | **Partially addressed** | `README.md:139-144, 201-206` are the Inno instructions ✅, but `README.md:145` still carries the pre-Inno sidecar name - see **A1** |

**Counts: 15 addressed, 2 partially addressed (M3, M14), 0 not addressed.**

## B. New defects introduced by the fixes

**N1. Important - `selectRows` never confirms that the list it is indexing is the filtered one, and
the `N selected` guard cannot tell.**
`frontend/scripts/acceptance.mjs:287-298`, used at `:431` and `:543`.
`openScreen("Data", ...)` remounts `DataManagerScreen`, which starts at `DEFAULT_QUERY` with
`labeled: "all"` (`listModel.ts:29-40`) and immediately fetches 200 unfiltered rows; only then does
the driver set the `Labeled` filter and click **List**. The gate at `:290-294` is
`aria-rowcount >= count`, which the *unfiltered* list satisfies too. Scenario (step 6, real run):
the unfiltered list is on screen when `revealRow(items[0], 0)` finds and clicks the first unlabeled
image at UI index 20 and `revealRow(items[49], 49)` then finds the 50th at UI index 69; the
shift-click selects rows 20..69 - 50 rows, 30 of which are the labeled ones from step 4. `selectRows`
then passes, because `clickSelect` (`selection.ts:15-22`) resolved the range from the *current* ids,
and step 6's own assertion is only `run.image_ids.length === cfg.queryImages` (`:582`), which is
still 50. The acceptance run then reports a pass for a query run over the wrong images. The guard is
weaker still than it looks: `page.getByText(\`${count} selected\`)` (`:298`) is a substring match, so
"150 selected" also satisfies "50 selected".
Fix: after clicking **List**, wait for the grid to hold the *filtered* count (compare `aria-rowcount`
against the `total` the same filtered API query returns) before indexing; use
`getByText(..., { exact: true })`; and close the loop at the end by asserting set equality between
`run.image_ids` (step 6) / the dataset's members (step 4) and the ids the driver intended.

**N2. Minor - the table can undo `revealRow`'s scroll between the two clicks.**
`ImageTable.tsx:43` runs `scrollToIndex(focusIndex)` whenever `focusIndex` *or* the memoised
`scrollToIndex` changes, and `scrollToIndex` is rebuilt whenever the measured `height` changes
(`useVirtualRows.ts:113-123`). The first row click makes `SelectionBar` appear
(`DataManagerScreen.tsx:140`), which shrinks the table, fires the ResizeObserver, and re-runs the
effect with `focusIndex = 0` - `useVirtualRows.ts:119` then snaps `scrollTop` back to 0 just as
`revealRow(items[count-1], ...)` has scrolled to row 49. The 250 ms retry loop absorbs this in the
common case; the residual window is between `locator.count() > 0` and `.click()`, where the row can
be unmounted and the click times out. Fix: do the click inside the retry loop, or re-check
`count()` immediately before clicking.

**N3. Minor - `failed_step` can name a step that passed.**
`acceptance.mjs:664`. See M3 above. Fix: track the current step name in a variable set at the top of
each section, or push a placeholder step entry before the work and update it in `step()`.

**N4. Minor - `openAndPreannotate` stalls 300 s with an opaque error when no pre-annotation model is
set.**
`acceptance.mjs:206-216` skips the wait only when unreviewed proposals exist, but
`useEditorImage.ts:37` also skips the POST when `preannotationModelId` is null. The driver clicks
"Use as pre-annotation model" and only `sleep(1500)`s (`:388-395`) before entering the loop; it reads
`preannotation_model_id` at `:396` but asserts it only after the loop (`:404-410`). If the click did
not take, the run blocks for five minutes and dies with a `waitForResponse` timeout rather than
"the pre-annotation model is not set". Fix: assert `projectAfterModel.preannotation_model_id` before
the loop and pass it into the skip condition.

**N5. Minor - step 5 counts any `job.progress`, not one per epoch.**
`acceptance.mjs:506-508, 524` counts every `job.progress` event for the job, including the
queued/running lines, so `>= epochs` can be satisfied without an event per epoch, which is what
`scripts/acceptance.md:84-86` promises. Fix: count events whose `message` matches the epoch card's
`n / N` shape, or assert the epoch card text (`:516-519`, currently swallowed with `.catch(() => "")`)
equals `${epochs} / ${epochs}`.

**N6. Minor - `reviewRows` counts mounted rows, not the queue.**
`acceptance.mjs:567-572` counts `role="row"` elements with a checkbox, but the Review queue is the
same virtualised `ImageTable` (`ReviewScreen.tsx:82`), so the number is the size of the scroll window
(or 0), not the queue. It is evidence-only, but it is printed as if it were the queue's size; the
report's own two dry runs show 0 and 1 for the same situation. Fix: read `aria-rowcount` instead.

---

## Overall verdict

**Approved with fixes.**

Task 3 (`b96c6d9`) meets every item of the goal-owner ruling, and the two claims that mattered - that
the shell plugin resolves `<exe dir>\machinery-backend.exe`, and that emptying `bundle.targets`
costs neither dev staging nor the exe icon - hold up against `tauri-plugin-shell 2.3.6` and
`tauri-build 2.6.3` source. The PowerShell script avoids the PS 5.1 traps it needed to. Fix **A1**
before the goal owner installs, because it is the one line that would send someone looking for the
wrong file in the install tree.

Fix round 1 (`6cdd435`) resolves C1 and I1-I4 in substance, not just in the report: the range
selection matches `selection.ts`, the `/preannotate` wait is registered before navigation and pinned
to the image id, the key path never touches a stored key, the provenance filter uses a field the
backend really writes, and the websocket is really open before the training form is filled. Two
minors are partial (M3, M14) and one new **Important** (N1) should be fixed before the real
acceptance run, since it can silently validate a run over the wrong images and the current guard
cannot detect it.

Blocking for the acceptance run: **A1, N1**. Everything else is Minor.

Counts: Critical 0, Important 2 (A1, N1), Minor 12 (A2-A8, N2-N6).
