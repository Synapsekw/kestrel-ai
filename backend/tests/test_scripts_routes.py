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
    # `kind` is required on POST /projects (BK), so every project the smoke creates names one. The
    # main project trains (BL), so it must be "train". The point-cloud step (S1) needs a project that
    # can hold clouds, which a training project cannot, so its own project is "detect".
    text = (SCRIPTS / "smoke_frozen.ps1").read_text("utf-8")
    creates = [line.strip() for line in text.splitlines() if 'POST "/projects"' in line]
    assert creates, "smoke_frozen.ps1 no longer creates a project"
    for line in creates:
        assert re.search(r'kind = "(train|detect)"', line), (
            f"project created without an explicit kind: {line}"
        )
    main = [line for line in creates if line.startswith("$project =")]
    assert len(main) == 1 and 'kind = "train"' in main[0], f"the main smoke project must train: {main}"
    for line in creates:
        if line in main:
            continue
        assert line.startswith("$pcProject =") and 'kind = "detect"' in line, (
            f"only the point-cloud step's project may be other than train: {line}"
        )
