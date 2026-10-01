"""A broken `app.setup` import costs only the setup endpoints, never the app (AGENTS.md invariant;
index 2026-09-30-setup-index "Backend": the router is included in one guarded block like Reports).
The setup page then offers Blank only; projects are still created through `POST /projects`."""

import importlib
import logging
import sys

from fastapi.testclient import TestClient

import app.api  # noqa: F401 - "app.api" is in sys.modules before the reloads below
from app.main import create_app

AUTH = {"Authorization": "Bearer test-token"}


def test_a_failed_setup_import_costs_only_the_setup_endpoints(monkeypatch, settings, caplog):
    monkeypatch.setitem(sys.modules, "app.setup.router", None)  # None makes the import raise
    try:
        with caplog.at_level(logging.ERROR):
            importlib.reload(sys.modules["app.api"])
        with TestClient(create_app(settings), headers=AUTH) as client:
            assert client.get("/api/v1/project-templates").status_code == 404
            assert client.post("/api/v1/setup/inspect", json={"paths": ["C:\\x"]}).status_code == 404
            assert client.get("/api/v1/catalogue/types").status_code == 200
            assert client.get("/api/v1/projects").status_code == 200
            assert client.get("/api/v1/health").status_code == 200
    finally:
        monkeypatch.undo()
        importlib.reload(sys.modules["app.api"])  # every later test gets the full router back
    assert "setup router failed to load" in caplog.text
