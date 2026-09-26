---
type: adr
date: 2026-09-25
status: accepted
tags: [decision, gotcha, testing]
related: []
---

# 2026-09-25-gotcha-maps-guard-test-leaves-app-api-stale

## Context

`tests/test_api_maps_guard.py` runs `monkeypatch.delitem(sys.modules, "app.api")` and then calls `create_app()`. That call imports `app.api` again, and the import rebinds the `app` package's `.api` attribute to the new module. `monkeypatch.undo` puts back only the old `sys.modules["app.api"]`. It leaves the package attribute alone. From then on `app.api is not sys.modules["app.api"]`.

A later test that writes `importlib.reload(app.api)` then fails with `ImportError: module app.api not in sys.modules`. Whether it fails depends on test order: it happens only when the maps guard test ran first in the same process. F0's router-guard test hit this.

## Decision

Reload the module through `sys.modules`: `importlib.reload(sys.modules["app.api"])`. `tests/test_pointcloud_router_guard.py` does this. Look the module up at the call, not in a name bound at import time.

## Rationale

`reload()` checks that its argument *is* the module in `sys.modules`. `sys.modules` is the entry that `monkeypatch.undo` restores, so it is the one that stays correct. The package attribute can be stale.

## Consequences

- Positive: guard tests that reload `app.api` pass in any order.
- Negative: none. The maps guard test stays as it is.
- Open follow-ups: none. The same trap applies to any test that deletes a module from `sys.modules` and imports it again.

## Related

- `backend/tests/test_api_maps_guard.py`, `backend/tests/test_pointcloud_router_guard.py`
