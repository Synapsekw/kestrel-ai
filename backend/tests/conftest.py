from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

TOKEN = "test-token"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(token=TOKEN, data_dir=tmp_path / "appdata", port=0)


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app, headers={"Authorization": f"Bearer {TOKEN}"}) as c:
        yield c


@pytest.fixture
def anon(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def project_dir(tmp_path: Path) -> Path:
    d = tmp_path / "proj"
    d.mkdir()
    return d


@pytest.fixture(scope="session")
def backend_dir() -> Path:
    """The `backend/` folder: the working directory a worker subprocess needs to resolve `app`."""
    return Path(__file__).resolve().parents[1]


@pytest.fixture
def project(client, project_dir) -> dict:
    """A project with the two aerial classes the training tests use."""
    body = {
        "name": "A",
        "folder": str(project_dir),
        "classes": [
            {"name": "excavator", "colour": "#ff0000"},
            {"name": "dump_truck", "colour": "#00ff00"},
        ],
    }
    r = client.post("/api/v1/projects", json=body)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def project_id(project) -> str:
    return project["id"]


@pytest.fixture
def handle(app, project_id):
    """The open ProjectHandle behind `project_id` (folders, session)."""
    return app.state.projects.get(project_id)
