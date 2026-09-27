# Foundation X: real-folder migration dry run, repeated on main (index Step 4, spec §11.5)

- **Date:** 2026-09-27
- **Code:** `main` at `7477e3c`, pipeline **armed** (worktree `task/f-x`; `backend/` is identical to
  `main` for this run — no code changes were made or needed)
- **Where it ran:** on copies only. The script copies each `project.db` (with `-wal`/`-shm`) and
  the app's `library.db`/`catalogue.db` into a temp folder and upgrades the copies. Kestrel AI was
  not running (checked with `Get-Process '*kestrel*'` before the session; no match).

## Inputs

| Folder                                                         | Revision before | Classes | Boxes   | Project datasets       |
| -------------------------------------------------------------- | --------------- | ------- | ------- | ---------------------- |
| `E:\Projects\AHTest` (the recent list; display name "Ahmadia") | `0009`          | 7       | 11,951  | 4 materialised         |
| `E:\Projects\Ahmadia`                                          | `0001`          | 1       | 0       | none                   |
| `%TEMP%\acceptance-project`                                    | `0002`          | 8       | 108,327 | `v1`, not materialised |

All three folders existed and were used (none missing).

## Commands (from `backend\`)

```powershell
$PY = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"
& $PY scripts\migration_dry_run.py --recent --folders E:\Projects\Ahmadia "$env:TEMP\acceptance-project" --out ..\docs\evidence\foundation-migration\x-main\dry-run.json *> ..\docs\evidence\foundation-migration\x-main\dry-run.txt   # exit 0

$broken = Join-Path $env:TEMP "x-broken-project"   # a file of text named project.db
& $PY scripts\migration_dry_run.py --folders E:\Projects\AHTest $broken *> ..\docs\evidence\foundation-migration\x-main\broken-run.txt   # exit 1
Remove-Item -Recurse -Force $broken   # deleted afterwards; the only temp folder this run created

$env:KESTREL_REAL_PROJECTS = "E:\Projects\AHTest;E:\Projects\Ahmadia;$env:TEMP\acceptance-project"
& $PY -m pytest tests/test_migration_real.py -v -m real_data   # 1 passed
Remove-Item Env:\KESTREL_REAL_PROJECTS
```

APP_DATA_DIR was never set: `default_data_dir()` resolved to the real
`%APPDATA%\ai.synapse-solutions.kestrel-ai` so the script found and copied the real
`recent_projects.json` and `library\{library.db,library.db-wal,library.db-shm}`. Nothing outside
`migration_dry_run.py` touched the operator's real app data or project folders; the app and backend
were never started against real data.

## Pass criteria (values read from `dry-run.json`)

| #   | Criterion                                                                                                      | Result                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | exit 0, `ok`, `armed`, three projects in order AHTest, Ahmadia, acceptance                                     | exit 0, `ok: true`, `armed: true`, order as listed                                                                                                                                                                                                                                               |
| 2   | each `ok`, no error, `revision_after` = head, `schema_version_after` = 2, backup expected and `quick_check` ok | all three: `0009/0001/0002 -> 0010`, v2, backup `ok`                                                                                                                                                                                                                                             |
| 3   | `mismatches: []` (row counts and count totals unchanged)                                                       | `[]` for all three; box rewrites 11,951 / 0 / 108,327                                                                                                                                                                                                                                            |
| 4   | `originals_unchanged: true`                                                                                    | true for all three (per `dry-run.json`); independently confirmed: SHA-256 of every original `project.db`, `-wal`, `-shm`, plus the app-data files the script reads, identical before and after the whole session (see `hashes.txt`); no `backups` folder appeared in any original project folder |
| 5   | `project_types` 7 / 1 / 8; `unmapped_boxes` 0; `findings` 0                                                    | 7 / 1 / 8; 0 / 0 / 0; 0 / 0 / 0                                                                                                                                                                                                                                                                  |
| 6   | 8 catalogue types, all `object`/`migrated`, AHTest's hotkeys, wheel_loader none, `needs_classification`        | backhoe 7, bulldozer 2, concrete_mixer 5, crane 4, dump_truck 3, excavator 1, roller 6, wheel_loader none; `needs_classification: true`                                                                                                                                                          |
| 7   | 4 legacy datasets `"<name> (Ahmadia)"` under `E:\Projects\AHTest\datasets\`; acceptance `v1` only a warning    | `ICVD_V2`, `ICVD_V3`, `ICVD_V4`, `Initial_Construction_Vehicle_Detection`, each `(Ahmadia)` (AHTest's project name is "Ahmadia"), paths under `E:\Projects\AHTest\datasets\`; `v1` warned "never built on disk"                                                                                  |
| 8   | every warning of an expected kind                                                                              | yes, see below                                                                                                                                                                                                                                                                                   |
| 9   | durations recorded; acceptance well under a minute                                                             | AHTest 0.375 s, Ahmadia 0.110 s, acceptance 1.687 s                                                                                                                                                                                                                                              |

Skip-and-flag (`broken-run.txt`): `[ok]` AHTest, `[FAILED]` the broken folder
(`x-broken-project`, `DatabaseError: file is not a database`), run ends `FAIL`, exit 1. One broken
project does not stop the others. The broken temp folder was created and deleted only by this run
(`x-broken-project`); a stray, unrelated `mg-broken-project` folder already present in `%TEMP%` was
left untouched, since it was not created by this session.

## Warnings

All on `acceptance-project`, all expected kinds:

- six hotkey notes. Acceptance had wheel_loader on 2 and the other classes shifted by one; the
  catalogue keeps AHTest's keys (merged first), so wheel_loader gets no hotkey in this project and
  the others use the catalogue's key.
- `dataset v1 was never built on disk (datasets/v1); it is not carried into Models`.

No model class maps existed in these projects, so no "model missing from the library" note.

## Hash check (criterion 4, independent confirmation)

Full before/after table and verdict: `hashes.txt` (raw snapshots: `hash-before.txt`,
`hash-after.txt`). Summary: every hashed file — each project's `project.db`/`-wal`/`-shm`, and the
app-data `recent_projects.json` and `library\{library.db,library.db-wal,library.db-shm}` (the
`catalogue.db*` files do not exist on this machine, before or after) — is byte-identical before and
after the whole session (dry run + broken-folder run + pytest). No original project folder gained a
`backups` directory. **Verdict: PASS.**

## Differences from MG's run

- **Code base:** MG ran on branch `task/f-mg-steps` at `110c9f6` (rebased on `main` `54126d1`); this
  run is on `main` `7477e3c` directly. `backend/` is unchanged between those two points (confirmed:
  this worktree's `backend/` == `main` `7477e3c`, and the intervening commits on `main` are
  contract/docs/frontend changes, not migration code), so every business-logic number reproduces
  MG's run exactly: same revisions before (`0009`/`0001`/`0002`), same catalogue merge/create
  counts, same box-rewrite counts (11,951 / 0 / 108,327), same 4 legacy datasets, the same 6 hotkey
  warnings plus the same `v1` warning.
- **Timing noise only:** per-project seconds differ in the third decimal (Ahmadia 0.110 s here vs
  0.109 s in MG's run; acceptance 1.687 s vs 1.688 s) — normal run-to-run variance, not a
  behavioural difference.
- **Broken-folder name:** this run's placeholder is `%TEMP%\x-broken-project` (MG's was
  `mg-broken-project`) so the two runs' scratch folders never collide; both are a plain text file
  named `project.db`, and both fail the same way (`file is not a database`).
- **catalogue.db does not exist yet** on this machine's app data (`%APPDATA%\ai.synapse-solutions.kestrel-ai\library\`)
  — the migration creates it fresh inside the temp copy each time, so this has no effect on the
  run; noted here only because the hash table records it as "(absent)" both before and after rather
  than a hash.
- No criterion failed, and no number diverged from MG's run beyond sub-millisecond timing —
  the real data on this machine has not changed since MG's run, and neither has the migration code.
