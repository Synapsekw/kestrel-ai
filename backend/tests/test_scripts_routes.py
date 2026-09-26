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
    for path in (
        "/library/status",
        "/library/starters/yolo11n/acquire",
        "/library/jobs",
        "/library/datasets",
        "/library/training-runs",
    ):
        assert path in text, f"smoke_frozen.ps1 does not call {path}"


def test_frozen_smoke_creates_projects_via_the_catalogue() -> None:
    # `type_ids` (catalogue type ids) replaced `kind`/`classes` on POST /projects (BC, task 13b):
    # every project the smoke creates gets its types from the catalogue helper first.
    text = (SCRIPTS / "smoke_frozen.ps1").read_text("utf-8")
    lines = text.splitlines()
    call_idx = [
        i
        for i, line in enumerate(lines)
        if "Get-CatalogueTypeId" in line and not line.strip().startswith("function")
    ]
    assert call_idx, "smoke_frozen.ps1 no longer calls the catalogue type helper"
    create_idx = [i for i, line in enumerate(lines) if 'POST "/projects"' in line]
    assert create_idx, "smoke_frozen.ps1 no longer creates a project"
    first_call = min(call_idx)
    for i in create_idx:
        line = lines[i].strip()
        assert "type_ids" in line, f"project created without type_ids: {line}"
        assert "kind =" not in line, f"project create body still sends kind: {line}"
        assert "classes =" not in line, f"project create body still sends classes: {line}"
        assert i > first_call, f"project created before the catalogue helper ran: {line}"


@pytest.mark.parametrize("script", ["checkpoint2_backend.py", "pointcloud_acceptance.py"])
def test_python_script_creates_projects_via_the_catalogue(script: str) -> None:
    """Same rule as the frozen smoke test (task 13b): the Python driver scripts also create their
    project types through the catalogue, sending `type_ids` and never `kind`/`classes` on
    POST /projects."""
    text = (SCRIPTS / script).read_text("utf-8")
    match = re.search(r'\.post\(\s*"(?:/api/v1)?/projects"', text)
    assert match, f"{script} no longer posts to /projects"
    # the call's own statement: from the opening paren of .post( to its matching close paren.
    start = text.index("(", match.start())
    depth = 0
    end = start
    for i, ch in enumerate(text[start:], start):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                end = i
                break
    body = text[start : end + 1]
    if "json=body" in body:
        # the dict is built separately just above the call (pointcloud_acceptance.py's new_project).
        body_start = text.rindex("body = {", 0, start)
        body_end = text.index("}", body_start)
        body += text[body_start : body_end + 1]
    assert '"type_ids"' in body, f"{script} does not send type_ids on POST /projects: {body}"
    assert '"kind"' not in body, f"{script} still sends kind on POST /projects: {body}"
    assert '"classes"' not in body, f"{script} still sends classes on POST /projects: {body}"
