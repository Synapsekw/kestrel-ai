"""A new router whose import fails costs only its own endpoints, never the app (AGENTS.md invariant).

laspy, scipy and rasterio are native stacks; a broken one in the frozen bundle must not stop the
backend from starting. `app/api.py` includes the four F0 routers inside a guard, like the maps one.
"""

import importlib
import logging
import sys

from fastapi.testclient import TestClient

import app.api  # noqa: F401 - ensures "app.api" is in sys.modules before the reload below
from app.main import create_app


def test_a_router_that_fails_to_import_costs_only_its_endpoints(monkeypatch, settings, caplog):
    # A None entry in sys.modules makes `import app.pointclouds.router` raise ImportError.
    monkeypatch.setitem(sys.modules, "app.pointclouds.router", None)
    try:
        with caplog.at_level(logging.ERROR, logger="app.api"):
            # Fetched fresh from sys.modules (not the `app.api` attribute bound above): another
            # guard test (test_api_maps_guard.py) evicts and re-imports "app.api" inside
            # create_app(), which leaves the `app` package's `.api` attribute pointing at a
            # different module object than sys.modules["app.api"] once its monkeypatch unwinds.
            # reload() requires identity with sys.modules, so it must be looked up here, not
            # through the possibly-stale `app.api` name.
            importlib.reload(sys.modules["app.api"])
        with TestClient(create_app(settings), headers={"Authorization": "Bearer test-token"}) as client:
            body = {
                "name": "d",
                "folder": str(settings.data_dir.parent / "d"),
                "classes": [],
                "kind": "detect",
            }
            pid = client.post("/api/v1/projects", json=body).json()["id"]
            assert client.get(f"/api/v1/projects/{pid}/pointclouds").status_code == 404
            assert client.get(f"/api/v1/projects/{pid}/surfaces").status_code == 501
            assert client.get("/api/v1/health").status_code == 200
    finally:
        monkeypatch.undo()
        importlib.reload(sys.modules["app.api"])  # every later test gets the full router back
    assert "app.pointclouds.router failed to load" in caplog.text
