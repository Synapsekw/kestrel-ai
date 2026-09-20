# SDD ledger — plan: docs/superpowers/plans/2026-09-20-kestrel-ai-rename.md

Spec: `docs/superpowers/specs/2026-09-20-kestrel-ai-rename-design.md` (read — binding authority)
Worktree: `E:\Dev\Yolo\app\.worktrees\kestrel-rename` on `task/kestrel-rename`, cut from main @ 6aa6612
Ledger lives in the MAIN checkout's workspace so it survives worktree removal.

## Environment rulings

Ruling: backend commands use the main checkout's interpreter
`E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m {ruff,pytest}` run with cwd inside the
worktree, instead of creating a second venv or junctioning one in — why: a worktree venv is
multi-GB, and this repo already lost a shared venv to a worktree deletion (progress.md,
2026-09-18); verified working (ruff clean, 11/11 test_keys_config in the worktree) — cost if
wrong: the gate could pass against stale site-packages; mitigated because the code under test
resolves from the worktree cwd, which the smoke run confirmed.

Ruling: `cargo` is not on this shell's PATH; use `C:\Users\D\.cargo\bin\cargo.exe` explicitly —
why: README notes `%USERPROFILE%\.cargo\bin` is only on PATH in a fresh shell — cost if wrong:
none, it is a path spelling.

Ruling: pnpm deps installed in the worktree for `frontend/` and `contract/` (6.1s / 3.8s,
hardlinked from the pnpm store) — why: bare `vitest`/`tsc`/`eslint` in package scripts resolve
no binary without a local `node_modules/.bin` — cost if wrong: none.

## Pre-flight conflict scan

Every task pair sharing a file or an interface, plus each task against itself.

| Pair / task | Produces → Consumes | Finding |
| --- | --- | --- |
| T1 ↔ T2 | both listed against `backend/app/providers/keys.py` | **CLEAN** — T2's step list excludes keys.py and its Interfaces block says "already committed — do not re-edit" |
| T2 → T4 | `kestrel-backend` sidecar name → `tauri.conf.json` externalBin + `capabilities/default.json` | CLEAN — identical string both sides |
| T3 → T4 | `appdata::migrate`, `Migration{NothingToDo,Moved,BothPresent,Failed}` → `lib.rs` setup | CLEAN — T4 Step 5 matches all four variants; both edit `lib.rs` but are an ordered pair, never parallel |
| T2 → T6 | staged `kestrel-backend-x86_64-pc-windows-msvc.exe` → `.iss` SidecarExe | CLEAN |
| T4 → T6 | Cargo package `kestrel-ai` → `kestrel-ai.exe` in `.iss` AppExe | CLEAN |
| T5 → T6 | `kestrel-ai.iss` filename written into `build-installer.ps1` before T6 creates the file | CLEAN — nothing executes that script until T10 |
| T7, T8 | no shared files | CLEAN |
| T1 self | tests vs code | CLEAN — `FakeKeyring.errors.PasswordDeleteError` matches the `except keyring.errors.PasswordDeleteError` in `_forget` |
| T3 self | tests vs code | CLEAN — Step 1 creates a test-only module so Step 2's expected compile failure is real |
| T5 self | fixture path vs T2's new dev default | CLEAN — both become `kestrel-ai` |
| **T1 → T2 Step 5** | T1 adds `LEGACY_SERVICE = "machinery-app"` → T2 Step 5 greps `backend` for `machinery-app` and **expects no output** | **CONFLICT** |
| **T9 Step 1** | expected-hits list vs files that legitimately keep old names | **CONFLICT** — omits the plan file and the new progress.md note |

### Rulings on the scan

Ruling: Task 2 Step 5's verification is amended to expect exactly one hit —
`backend/app/providers/keys.py` `LEGACY_SERVICE` — instead of no output. Why: Task 1 deliberately
keeps the pre-rename service name as migration code (spec §3.2), so the plan's own verification
would fail against correct work. The spec is the authority and it mandates the legacy constant.
Cost if wrong: an implementer chases a phantom failure, or worse, deletes `LEGACY_SERVICE` to make
the grep pass — which would silently strand the operator's API keys. Plan amended before brief
extraction.

Ruling: Task 9 Step 1's expected-hits list gains two entries — (a)
`docs/superpowers/plans/2026-09-20-kestrel-ai-rename.md`, which quotes every old name in its
Global Constraints and name map, and (b) the rename note Task 8 Step 4 adds to the **Current
state** section of `docs/progress.md`, which is not inside a dated section. Why: without them the
final sweep reports false positives and an implementer may "fix" them by corrupting the plan or
deleting the note. Cost if wrong: none — the list is an allowlist for a read-only grep. Plan
amended before brief extraction.

## Task log

Briefs extracted for tasks 1-9 into the worktree workspace.

Dispatch order (revised from the plan's Batch A, since implementers never run in parallel):
T1 (keystore, TDD) -> T3 (Rust migration, TDD) -> T2 (backend rename) -> T5 (frontend/scripts)
-> T7+T8 batched (contract + CI/docs, both pure text) -> T4 (Tauri + wiring) -> T6 (installer)
-> T9 (sweep + full gate). T10 (rebuild) and T11 (install + acceptance) need the operator's
machine and are handed over, not dispatched.

Task 1: dispatched (haiku; brief has complete code, so transcription + testing), BASE 2c9bdfd
Task 1: complete (commits 2c9bdfd..305c28c, review clean — spec met on all 7 points, quality approved)
Task 1: minor (deferred): keys.py get() uses `if current:` not `is not None`, so an empty-string
  value under the new service would fall through to legacy. Pre-existing truthiness pattern, and
  set() rejects empty keys, so unreachable in practice. Flag to the final review.
Task 1: reviewer confirmed the write-new-before-delete-legacy ordering has no key-loss path in
  either failure mode (not a defect; recorded so the final review need not re-derive it).
Task 3: dispatched (haiku; brief carries complete Rust code), BASE 305c28c
Task 3: complete (commits 305c28c..9363bdc, review clean — spec met, quality approved)
Task 3: minor (deferred): appdata.rs create_dir_all branch for a missing parent is never exercised
  by a test; no test drives the Failed path; theoretical TOCTOU between exists() and fs::rename.
  All three are brief-faithful (code lifted verbatim from the brief) and low risk for a
  single-user desktop launch. Flag to the final review.
Task 2: dispatched (haiku; mechanical rename with exact target strings), BASE 9363bdc
Task 2: complete (commits 9363bdc..009bbd4, review clean — spec met on all 12 points, approved)
  Gate: ruff clean, pytest 583 passed / 9 deselected. All downstream-contract paths in build.ps1
  and smoke_frozen.ps1 verified character-by-character by the reviewer.
Task 2: Ruling: the reviewer's Minor — smoke_frozen.ps1:41 still names temp dirs
  "machinery-smoke-<guid>" — is real and would NOT be caught by Task 9's sweep, whose grep matches
  only machinery-app|machinery-backend|machinery_backend|machinery_app|Machinery Detection|
  machinery-detection|machinery-logfile, none of which match "machinery-smoke". Rather than open a
  fix round for a cosmetic temp-folder name, it is carried into Task 9's dispatch as an explicit
  extra fix, since Task 9 already owns sweep fixes and commits them. Cost if wrong: a leftover old
  name in ephemeral TEMP folder names; no functional impact.
Task 2: minor (deferred): commit 009bbd4's Co-Authored-By trailer is glued to the subject line with
  no blank line between. Cosmetic git-history nit; fix at merge time if the history is tidied.
Task 5: dispatched (haiku; mechanical string edits with exact targets), BASE 009bbd4
Task 5: complete (commits 009bbd4..9c37a2b, review clean — spec met, ZERO issues, approved)
  Reviewer classified all 10 removed "machinery" strings as product-identifier; no domain-noun
  copy touched. Wildcard vs no-wildcard Get-Process forms preserved per call site.
Tasks 7+8: dispatched as ONE batch (sonnet; both are pure text edits over disjoint files —
  contract title/package name, and CI path + doc prose + a git mv). BASE 9c37a2b
Tasks 7+8: implemented (21e8603 contract, b18386e docs). Contract check passed.

Task 7: Ruling: the implementer's concern that schema.d.ts showed ZERO diff (not even title-only)
  is CORRECT and my plan text was wrong. Verified directly: schema.d.ts has 0 occurrences of
  "backend API"/"Kestrel"/"Machinery" — openapi-typescript does not emit info.title into the
  generated types at all, so a zero diff is the expected result. The plan's "diff must show only
  the title change" should have read "must show no change". No action; recorded so the reviewer
  and the final review do not treat the zero diff as a missed regeneration.
  Cost if wrong: none — the contract check regenerates and compares, and it passed.

PLAN INVENTORY GAPS found by my own repo-wide grep (spec §4 missed these — "rename all" intent
covers them, so they are real, not scope creep):
  a) frontend/index.html:6  <title>Machinery Detection</title>  -- USER-VISIBLE window title.
  b) frontend/package.json:2  "name": "machinery-app-frontend"
  c) frontend/scripts/checkpoint4.mjs:75,81  Get-Process machinery-app  -- the APP exe process
     name (Task 5's brief only covered line 22's SIDECAR process name, so this is not a Task 5
     miss; the plan never listed these two lines).
  d) docs/superpowers/specs/2026-09-17-kestrel-ai-app-design.md:258 -- section 15 "Open items":
     "App name: owner to choose; default folder and identifiers use `machinery-app` until then."
     The name HAS now been chosen, so this open item is stale as well as old-named.
  e) KICKOFF_PROMPT.md:1 "build the machinery detection app". Note line 7's "aerial
     construction-machinery detection" is the DOMAIN and must stay.
  f) frontend/src-tauri/Cargo.lock:1815 name = "machinery-app" -- regenerates when Task 4 renames
     the Cargo package; no manual edit needed.

Ruling: (d) and (e) are inside Task 8's stated scope (plan §4.7 lists KICKOFF_PROMPT.md as
  rewritten, and says to update product-identifier mentions inside the renamed spec), so they go
  to the Task 7+8 review and, if confirmed, into that task's fix loop.
Ruling: (a), (b), (c) are outside every task's brief — the plan simply never listed them. Rather
  than retro-fit them into a closed task, they are carried into Task 9, which already owns
  sweep-and-fix, together with the Task 2 "machinery-smoke-" leftover. Task 9's dispatch will also
  add a case-insensitive bare-"machinery" sweep, because the plan's grep patterns miss lowercase
  "machinery detection" (e) and "machinery-smoke" entirely.
  Cost if wrong: a user-visible window title would have shipped saying "Machinery Detection" —
  which is exactly why the extra sweep is being added rather than trusting the plan's pattern list.
Tasks 7+8: fix round 1/5 (2 addressed, 0 open — KICKOFF_PROMPT.md title renamed; spec s15 app-name
  open item closed as resolved; commits b18386e..1ed1e0c). Scoped re-review: no new breakage,
  only the two expected files touched, domain-noun line 7 preserved.
Tasks 7+8: complete (commits 9c37a2b..1ed1e0c, review clean after 1 fix round)
  Frozen-history discipline verified by the reviewer: progress.md dated rows, the s0 plan file,
  .superpowers/sdd/** and docs/evidence/** all intact.
Task 4: dispatched (sonnet; multi-file integration + the runtime capability allow-list), BASE 1ed1e0c
Task 4: implemented (e4074a6). cargo test 8/8 (4 appdata + 4 logfile). Verified by controller:
  both capability allow-lists say binaries/kestrel-backend; tauri.conf productName/identifier/
  title/externalBin all renamed; lib.rs preserves the legacy folder name verbatim.
Task 4: Ruling on the implementer's DONE_WITH_CONCERNS — it created a 64-byte PLACEHOLDER at
  frontend/src-tauri/binaries/kestrel-backend-x86_64-pc-windows-msvc.exe because tauri-build
  resolves externalBin at COMPILE time and Task 2 had deleted the old (differently-named) sidecar.
  Verified: matched by .gitignore:19, absent from commit e4074a6, git status clean. Accepted as a
  legitimate build-environment stub, because Task 9 must run cargo test again and would hit the
  same wall. TWO obligations follow, both recorded here so they cannot be forgotten:
    (i) DELETE the placeholder before the branch is finished.
    (ii) Task 10 MUST run backend/scripts/build.ps1 (the real freeze) BEFORE any `tauri build` or
         installer build. Building against the stub would produce an installer whose "sidecar" is
         a 64-byte text file — it would install and launch with no backend.
  Cost if wrong: a shipped installer with a dead backend. Mitigated by (ii) being Task 10 Step 1
  already, and by Task 10 Step 4's explicit spawn/health check.
Task 4: review dispatched (sonnet), BASE 1ed1e0c
Task 4: complete (commits 1ed1e0c..e4074a6, review clean — spec met on all 15 points, ZERO issues)
  Reviewer confirmed migrate() runs strictly before sidecar::start (an inverted order would have
  made the migration a permanent silent no-op, untested), legacy path derived correctly from
  data_dir.parent(), all 4 Migration arms present, none aborting setup.
Task 6: dispatched (haiku; mechanical, exact values in brief), BASE e4074a6
Task 6: complete (commits e4074a6..b8380ce, review clean — spec met, ZERO issues)
  AppId independently confirmed unchanged by `git diff main -- frontend/installer/` (no AppId hunk).
  git mv detected as rename (R082), downstream contract with build-installer.ps1 verified both ways.
Task 9: dispatched (sonnet; requires judgment to adjudicate each sweep hit), BASE b8380ce
  Carrying four extra fixes the plan never listed (see PLAN INVENTORY GAPS above) plus the
  Task 2 "machinery-smoke-" leftover, and an added case-insensitive bare-"machinery" sweep.
Task 9: fix round 1/5 (1 addressed, 0 open — site-office-ui-design.md:69 sidebar wordmark;
  commits 2118042..f66a26d)
Task 9: Ruling: docs/superpowers/specs/2026-09-19-site-office-ui-design.md:69 IS a genuine miss,
  not frozen history. It is a LIVE design spec describing the shipping shell (same class as the
  2026-09-17 app-design spec, which was renamed), and it directly contradicted Brand.tsx:17. A
  design spec that disagrees with the code is worse than a stale name — someone "fixes" the code
  to match it. Frozen history is only: dated progress.md rows, .superpowers/sdd/**,
  docs/evidence/**, and the historical build plans. Cost if wrong: an edited line in a design doc.
Task 9: complete (commits b8380ce..f66a26d, review clean — spec PASS, ZERO issues, approved)
  ALL SIX GATES GREEN: contract check PASS; ruff clean; pytest 583 passed / 9 deselected;
  frontend lint PASS; vitest 462 passed (116 files); frontend build PASS; cargo test 8 passed.
  Reviewer independently reran the wide sweep (44 files hit, identical to the report), spot-checked
  8 adjudication entries against the real files, found no misclassification, and confirmed the
  app-process name (kestrel-ai) was not conflated with the sidecar name (kestrel-backend).

ALL CODE TASKS (1-9) COMPLETE. Tasks 10 (rebuild) and 11 (install + acceptance) require the
operator's machine and are a handover, not a dispatch.
Final whole-branch review: dispatched (opus, most capable per Model Selection).

FINAL WHOLE-BRANCH REVIEW (opus): APPROVED FOR MERGE.
  Independently found no data-loss path in either migration. Confirmed both capability allow-list
  entries, the unchanged AppId, full cross-file name agreement, and empty diff for frozen history.
  One Important finding -> ONE fix wave (28dfe68): migration outcome was only eprintln'd, but
  release builds set windows_subsystem="windows" so there is no console -- a failed migration would
  have been undiagnosable. Now appended to the sidecar rotating log (naming the legacy path) inside
  each match arm, strictly AFTER migrate() returns, since RotatingLog::append creates logs/ and
  would otherwise create the new folder and make every future migration a silent BothPresent.
  Plus a comment warning the block must stay first in setup() to touch app_data_dir.
  Scoped re-review: fix accepted, ordering PASS, no new breakage.
  Three deferred minors triaged SHIP (empty-string key unreachable -- min_length=1 at both the
  Pydantic and OpenAPI layers; appdata untested branches/TOCTOU cannot clobber on Windows; glued
  Co-Authored-By trailer on 3 commits is cosmetic and not worth a 3-commit rebase at the gate).

Ruling: the SDD workspace is NOT deleted yet, against the skill's default. Why: the plan is not
  finished -- Tasks 10 (rebuild) and 11 (install + acceptance) still need the operator's machine,
  and this ledger is their recovery map. It is gitignored scratch and costs nothing to keep.
  Cost if wrong: a stale scratch directory. Delete after Task 11 closes.

INTEGRATION GATE re-run by the controller on the exact integration tree (28dfe68), not an earlier
  commit: contract check PASS; ruff clean; pytest 583 passed/9 deselected (139.99s); frontend lint
  PASS; vitest 462 passed (116 files); vite build PASS; cargo test 8 passed. Placeholder stub
  restored only for the Rust compile, then removed; working tree clean.
BRANCH READY. Merge NOT performed -- that is the operator's decision.

MERGED to main (fast-forward to 28dfe68, 39 files). Branch task/kestrel-rename deleted. Worktree
  removed: `git worktree remove` deregistered it but left the tree ("Directory not empty"), so
  cleanup followed the repo's rule -- verified all 2100 junctions resolved INSIDE the worktree
  (0 escaping), deleted them as links via .NET, then `rd /s /q`. The 26008 "outside" links were
  HARDLINKS sharing inodes with the pnpm store and sibling projects; deleting a hardlink drops only
  that name. Verified afterwards: contract/, frontend/, wave1 node_modules and E:\.pnpm-store intact.

Task 10 (steps 1-3) DONE by the controller:
  - freeze: dist/kestrel-backend 3,520.5 MB in 14,118 files, 152 s; sidecar staged as
    kestrel-backend-x86_64-pc-windows-msvc.exe
  - stale old-named artifacts removed from the sidecar slot and backend/dist
  - smoke_frozen: PASS -- health ok, cuda True RTX 5070 Ti, starter ok 3, predict ok, worker ok,
    export ok, total 27.25 s. Temp dir was "kestrel-smoke-557ed26c", confirming the Task 9 prefix fix.
  - installer: "Kestrel AI_0.1.0_x64-setup.exe" 1,853.1 MB in 443 s

KEYSTORE MIGRATION PROVEN ON REAL STATE (ahead of Task 11): the frozen backend's smoke run reported
  "a key is already stored for anthropic". Direct Credential Manager check: kestrel-ai/anthropic
  STORED, kestrel-ai/openai STORED, machinery-app/* none. Moved, not copied. Spec 3.2 satisfied.

PLAN DEFECT FOUND AT EXECUTION (Task 10 Step 4 vs Task 11 Step 4):
  Task 10 Step 4 says "launch the built app and confirm health" BEFORE Task 11 installs and checks
  the folder migration. But launching ANY build creates %APPDATA%\ai.synapse-solutions.kestrel-ai,
  which makes migrate() return BothPresent -- permanently stranding recent_projects.json in the old
  folder. The two steps contradict each other.
  Ruling: SKIP Task 10 Step 4 as a separate launch. The first launch of the INSTALLED app serves as
  both the sidecar-spawn check and the folder migration. Verified before handover that
  ai.synapse-solutions.kestrel-ai does NOT yet exist and the old folder still holds logs/,
  recent_projects.json and ultralytics/. Cost if wrong: none -- the spawn check still happens, just
  once, on the installed app where it matters.
