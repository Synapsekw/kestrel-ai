# Gotcha: xdist workers share Hypothesis and Ultralytics files

**Date:** 2026-09-28 · **Status:** accepted

## Context

Backend CI ran `pytest` in one process (~55 min on `windows-latest`). Speeding that up means
`pytest-xdist` (`-n auto`) and, on the 4-vCPU runner, two duration-balanced shards. Workers are
separate processes, but they inherit one working directory and one user profile.

## Cause

Two writable caches are process-global paths, not per-test temp dirs:

- Hypothesis stores examples under the checkout's `.hypothesis` directory and locks that directory.
  Several workers locking it on Windows is the same class of flake as the SQLite `-shm`/`-wal` locks.
- Ultralytics writes `settings.json` under the user profile unless `YOLO_CONFIG_DIR` is set. Parallel
  workers would write that file together, and a test run would touch the real profile.

API keys are already safe: app fixtures install `MemoryKeyStore`, and the Credential Manager test
only checks that the Windows backend is pinned. It does not read or write a password.

## Decision

`tests/conftest.py` `pytest_configure` runs only when `PYTEST_XDIST_WORKER` is set. Each worker gets
a private temp dir for `MPLCONFIGDIR` and `YOLO_CONFIG_DIR`. Serial `pytest` (including
`-p no:xdist`) does not set them. Tests that need one of those variables unset still clear it
themselves.

Hypothesis is the exception. On GitHub Actions the `CI` environment variable loads Hypothesis's
`ci` profile (`derandomize=True`, `database=None`) at import. Passing a database then raises
`derandomize=True implies database=None` while collecting `test_responses_conform`. That profile
already has no example file, so the hook leaves it alone. A local run is not derandomized, and
each worker gets its own `DirectoryBasedExampleDatabase` so they do not lock the checkout's
`.hypothesis` directory.

CI shards with `pytest-split` (`least_duration`, committed `backend/.test_durations`) and runs
`-n auto` inside each shard. Every collected test is in exactly one shard. Nothing is skipped to
save time.

## Consequence

A new test that writes to a fixed path outside `tmp_path` (a hard-coded port, a file under
`%APPDATA%`, a shared SQLite file) will flake only under `-n auto`. Point it at `tmp_path` or, if it
truly cannot run beside other tests, mark it with `xdist_group` — do not skip it.
