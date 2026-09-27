# Foundation MG: real-folder migration dry run (the merge gate)

- **Date:** 2026-09-27
- **Code:** branch `task/f-mg-steps` at `110c9f6` (rebased on `main` 54126d1), pipeline **armed**
- **Where it ran:** on copies only. The script copies each `project.db` (with `-wal`/`-shm`) and the
  app's `library.db`/`catalogue.db` into a temp folder and upgrades the copies. Kestrel AI was not
  running.

## Inputs

| Folder | Revision before | Classes | Boxes | Project datasets |
| --- | --- | --- | --- | --- |
| `E:\Projects\AHTest` (the recent list) | `0009` | 7 | 11,951 | 4 materialised |
| `E:\Projects\Ahmadia` | `0001` | 1 | 0 | none |
| `%TEMP%\acceptance-project` | `0002` | 8 | 108,327 | `v1`, not materialised |

## Commands (from `backend\`)

```powershell
$PY = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"
& $PY scripts\migration_dry_run.py --recent --folders E:\Projects\Ahmadia "$env:TEMP\acceptance-project" --out ..\docs\evidence\foundation-migration\dry-run.json *> ..\docs\evidence\foundation-migration\dry-run.txt   # exit 0

$broken = Join-Path $env:TEMP "mg-broken-project"   # a file of text named project.db
& $PY scripts\migration_dry_run.py --folders E:\Projects\AHTest $broken *> ..\docs\evidence\foundation-migration\broken-run.txt   # exit 1

$env:KESTREL_REAL_PROJECTS = "E:\Projects\AHTest;E:\Projects\Ahmadia;$env:TEMP\acceptance-project"
& $PY -m pytest tests/test_migration_real.py -v -m real_data   # 1 passed
```

## Pass criteria (values read from `dry-run.json`)

| # | Criterion | Result |
| --- | --- | --- |
| 1 | exit 0, `ok`, `armed`, three projects in order AHTest, Ahmadia, acceptance | exit 0, `ok: true`, `armed: true`, order as listed |
| 2 | each `ok`, no error, `revision_after` = head, `schema_version_after` = 2, backup expected and `quick_check` ok | all three: `0009/0001/0002 -> 0010`, v2, backup `ok` |
| 3 | `mismatches: []` (row counts and count totals unchanged) | `[]` for all three; box rewrites 11,951 / 0 / 108,327 |
| 4 | `originals_unchanged: true` | true for all three; also SHA-256 of every original `project.db`, `-wal`, `-shm` identical before and after the whole session (Steps 7–9), and no `backups` folder appeared in any original |
| 5 | `project_types` 7 / 1 / 8; `unmapped_boxes` 0; `findings` 0 | 7 / 1 / 8; 0 / 0 / 0; 0 / 0 / 0 |
| 6 | 8 catalogue types, all `object`/`migrated`, AHTest's hotkeys, wheel_loader none, `needs_classification` | backhoe 7, bulldozer 2, concrete_mixer 5, crane 4, dump_truck 3, excavator 1, roller 6, wheel_loader none; `needs_classification: true` |
| 7 | 4 legacy datasets `"<name> (Ahmadia)"` under `E:\Projects\AHTest\datasets\`; acceptance `v1` only a warning | `ICVD_V2`, `ICVD_V3`, `ICVD_V4`, `Initial_Construction_Vehicle_Detection`, each `(Ahmadia)` (AHTest's project name is "Ahmadia"), paths under `E:\Projects\AHTest\datasets\`; `v1` warned "never built on disk" |
| 8 | every warning of an expected kind | yes, see below |
| 9 | durations recorded; acceptance well under a minute | AHTest 0.375 s, Ahmadia 0.109 s, acceptance 1.688 s (whole run 3.0 s wall) |

Skip-and-flag (`broken-run.txt`): `[ok]` AHTest, `[FAILED]` the broken folder (not a database), run
ends `FAIL`, exit 1. One broken project does not stop the others.

## Warnings

All on `acceptance-project`, all expected kinds:
- six hotkey notes. Acceptance had wheel_loader on 2 and the other classes shifted by one; the
  catalogue keeps AHTest's keys (merged first), so wheel_loader gets no hotkey in this project and
  the others use the catalogue's key.
- `dataset v1 was never built on disk (datasets/v1); it is not carried into Models`.

No model class maps existed in these projects, so no "model missing from the library" note.
