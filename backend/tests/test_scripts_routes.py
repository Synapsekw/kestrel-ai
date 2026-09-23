"""The operator scripts in `backend/scripts/` call the API by path; no test runs them.

The frozen smoke test (`smoke_frozen.ps1`) is the proof that a packaging change works, so a route
it calls that the app no longer serves only shows up when someone runs it against a fresh build.
This pins the per-project model routes the library replaced out of every script.
"""

import re
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
# `/projects/<anything>/models...`: the per-project model registry, replaced by `/library/models`.
PROJECT_MODELS = re.compile(r"/projects/[^\s\"'/]+/models\b")


@pytest.mark.parametrize(
    "script",
    sorted(p.name for p in SCRIPTS.iterdir() if p.suffix in {".py", ".ps1"}),
)
def test_script_calls_no_removed_project_model_route(script: str) -> None:
    text = (SCRIPTS / script).read_text("utf-8")
    hits = [line.strip() for line in text.splitlines() if PROJECT_MODELS.search(line)]
    assert not hits, f"{script} still calls per-project model routes: {hits}"


def test_frozen_smoke_checks_the_library() -> None:
    text = (SCRIPTS / "smoke_frozen.ps1").read_text("utf-8")
    for path in ("/library/status", "/library/starters/yolo11n/acquire", "/library/jobs", "/train"):
        assert path in text, f"smoke_frozen.ps1 does not call {path}"


def test_frozen_smoke_creates_a_training_project() -> None:
    # `kind` is required on POST /projects (BK); the smoke then trains (BL), so it must be "train".
    text = (SCRIPTS / "smoke_frozen.ps1").read_text("utf-8")
    creates = [line for line in text.splitlines() if 'POST "/projects"' in line]
    assert creates, "smoke_frozen.ps1 no longer creates a project"
    for line in creates:
        assert 'kind = "train"' in line, f"project created without kind train: {line.strip()}"
