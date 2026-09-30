"""A broken `app.reports` import costs only the report endpoints, never the app (AGENTS.md
invariant; spec 2026-09-26-reports section 14: "a broken reportlab costs reports, never the app")."""

import importlib
import logging
import sys

from fastapi.testclient import TestClient
from project_factory import new_project

import app.api  # noqa: F401 - "app.api" is in sys.modules before the reloads below
from app.main import create_app

AUTH = {"Authorization": "Bearer test-token"}


def test_a_failed_reports_import_costs_only_the_report_endpoints(monkeypatch, settings, caplog):
    monkeypatch.setitem(sys.modules, "app.reports.router", None)  # None makes the import raise
    try:
        with caplog.at_level(logging.ERROR):
            importlib.reload(sys.modules["app.api"])
        with TestClient(create_app(settings), headers=AUTH) as client:
            pid = new_project(client, settings.data_dir.parent / "d", name="d")["id"]
            assert client.get(f"/api/v1/projects/{pid}/reports").status_code == 404
            assert client.get("/api/v1/report-templates").status_code == 404
            assert client.get(f"/api/v1/projects/{pid}/findings").status_code == 200
            assert client.get("/api/v1/health").status_code == 200
    finally:
        monkeypatch.undo()
        importlib.reload(sys.modules["app.api"])  # every later test gets the full router back
    assert "reports router failed to load" in caplog.text
