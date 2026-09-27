"""A new images or assist module whose import fails costs only its own endpoints, never the app
(AGENTS.md invariant; spec 2026-09-26-image-inspection §16 "SAM modules missing")."""

import importlib
import logging
import sys

from fastapi.testclient import TestClient
from project_factory import new_project

import app.api  # noqa: F401 - "app.api" is in sys.modules before the reloads below
import app.imagery.router  # noqa: F401 - likewise for the aggregator
from app.main import create_app

AUTH = {"Authorization": "Bearer test-token"}


def test_a_failed_assist_import_costs_only_the_assist_endpoints(monkeypatch, settings, caplog):
    monkeypatch.setitem(sys.modules, "app.assist.router", None)  # None makes the import raise
    try:
        with caplog.at_level(logging.ERROR):
            importlib.reload(sys.modules["app.api"])
        with TestClient(create_app(settings), headers=AUTH) as client:
            pid = new_project(client, settings.data_dir.parent / "d", name="d")["id"]
            assert client.post(f"/api/v1/projects/{pid}/images/x1/segment", json={}).status_code == 404
            assert client.get("/api/v1/library/assist-models").status_code == 404
            assert client.get(f"/api/v1/projects/{pid}/images/index").status_code in (200, 501)
            assert client.get("/api/v1/health").status_code == 200
    finally:
        monkeypatch.undo()
        importlib.reload(sys.modules["app.api"])  # every later test gets the full router back
    assert "app.assist.router failed to load" in caplog.text


def test_a_failed_route_module_costs_only_its_own_endpoints(monkeypatch, settings, caplog):
    monkeypatch.setitem(sys.modules, "app.imagery.routes_detect", None)
    try:
        with caplog.at_level(logging.ERROR):
            importlib.reload(sys.modules["app.imagery.router"])
            importlib.reload(sys.modules["app.api"])
        with TestClient(create_app(settings), headers=AUTH) as client:
            pid = new_project(client, settings.data_dir.parent / "d", name="d")["id"]
            assert client.post(f"/api/v1/projects/{pid}/images/x1/detect", json={}).status_code == 404
            assert client.get(f"/api/v1/projects/{pid}/images/index").status_code in (200, 501)
    finally:
        monkeypatch.undo()
        importlib.reload(sys.modules["app.imagery.router"])
        importlib.reload(sys.modules["app.api"])
    assert "app.imagery.routes_detect failed to load" in caplog.text
