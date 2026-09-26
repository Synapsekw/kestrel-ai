"""A project has no kind (spec 2026-09-26-foundation sections 6.1, 16 and 17): no guard is left, and
work that used to belong to one kind of project runs in any project."""

import importlib.util
import json
import re
from pathlib import Path

import pytest
from fastapi.routing import _IncludedRouter

from app.db.models import Job

BACKEND = Path(__file__).resolve().parents[1]
BASE = "/api/v1/projects"
# The retired guard's vocabulary. `run_kind`, `Source.kind`, `Surface.kind` and `provenance_kind`
# are other things and stay.
RETIRED = re.compile(
    r"\b(require_kind|project_kind|wrong_project_kind|ProjectKind|ANY_KIND|TRAIN_ONLY|DETECT_ONLY"
    r"|DETECT_WRITE|BOTH_KINDS|QUERY_RUN_KINDS)\b"
    r"|[\"']kind[\"']\s*:\s*[\"'](train|detect)[\"']|\bkind=[\"'](train|detect)[\"']"
)
SCANNED = ("app", "tests")


def _calls(dependant):
    for d in dependant.dependencies:
        yield d.call
        yield from _calls(d)


def _effective_routes(app):
    """Flatten `app.routes` through every included router.

    On FastAPI 0.141 `app.routes` holds `_IncludedRouter` objects, not the `APIRoute`s an
    `include_router` call adds (vault/decisions/
    2026-09-26-gotcha-fastapi-app-routes-hides-included-routers.md): a plain `isinstance(route,
    APIRoute)` walk of `app.routes` sees nothing and any assertion about "no route carries a guard"
    would pass vacuously. `_IncludedRouter.effective_candidates()` is the mechanism FastAPI itself
    uses to resolve one level of inclusion (each candidate is either a fully resolved route with a
    merged `dependant` - which folds in dependencies from every level of `include_router(...,
    dependencies=...)`, not only the ones declared on the router itself - or another `_IncludedRouter`
    for a nested include), so this recurses until only resolved routes are left.
    """
    found = []
    stack = list(app.routes)
    while stack:
        route = stack.pop()
        if isinstance(route, _IncludedRouter):
            stack.extend(route.effective_candidates())
        elif hasattr(route, "dependant") and hasattr(route, "path"):
            found.append(route)
    return found


def test_the_kind_module_is_gone():
    assert importlib.util.find_spec("app.projects.kinds") is None


def test_no_route_carries_a_kind_guard(app):
    routes = _effective_routes(app)
    # A walk that finds nothing proves nothing (the vault ADR above): pin that this one actually
    # reaches the app's routes before trusting what it did not find.
    assert len(routes) >= 100, f"the walk only reached {len(routes)} routes; it is not walking the app"
    guarded = sorted(
        route.path
        for route in routes
        if any(getattr(c, "__name__", "") in {"_check_kind", "_any_kind"} for c in _calls(route.dependant))
    )
    assert guarded == []


def test_no_source_file_names_the_retired_guard():
    hits = []
    # test_foundation_contract.py (C0) asserts these words are absent from the *contract* text; it
    # is the other test that lists them (global-constraints.md "Retired vocabulary").
    exempt = {Path(__file__).name, "test_foundation_contract.py"}
    for folder in SCANNED:
        for path in sorted((BACKEND / folder).rglob("*.py")):
            if path.name in exempt:
                continue
            for n, line in enumerate(path.read_text("utf-8").splitlines(), 1):
                if RETIRED.search(line):
                    hits.append(f"{path.relative_to(BACKEND)}:{n}: {line.strip()}")
    assert hits == []


WRITES = [
    # (method, path, body factory, status, error code): the project's own answer, never the guard's.
    ("post", "/images/nope/preannotate", lambda tmp: {}, 404, "not_found"),  # was training-only
    ("post", "/datasets", lambda tmp: {"name": "ds"}, 409, "conflict"),  # was training-only
    ("post", "/maps", lambda tmp: {"path": str(tmp / "missing.tif")}, 404, "not_found"),  # detection
    ("patch", "/sources/nope", lambda tmp: {"label": "x"}, 404, "not_found"),  # was detection-only
]


@pytest.mark.parametrize(("method", "path", "body", "status", "code"), WRITES)
def test_work_that_belonged_to_one_kind_runs_in_any_project(
    client, project_id, tmp_path, method, path, body, status, code
):
    r = getattr(client, method)(f"{BASE}/{project_id}{path}", json=body(tmp_path))
    assert (r.status_code, r.json()["error"]["code"]) == (status, code), r.text


@pytest.mark.parametrize(
    "path",
    ["/agent", "/adoption", "/datasets", "/runs", "/site-areas", "/analytics/areas", "/maps", "/surfaces"],
)
def test_reads_that_belonged_to_one_kind_answer_in_any_project(client, project_id, path):
    r = client.get(f"{BASE}/{project_id}{path}")
    assert r.status_code == 200, (path, r.text)


def test_the_move_map_route_is_gone(client, project_id):
    r = client.post(f"{BASE}/{project_id}/maps/m1/move", json={"target_project_id": "x"})
    assert r.status_code in (404, 405), r.text
    assert importlib.util.find_spec("app.maps.move") is None


def test_an_old_map_move_job_row_still_lists(client, handle, project_id):
    """`JobType` keeps `map_move` so jobs from before the split still validate (spec 6.1)."""
    with handle.session() as s:
        s.add(Job(type="map_move", state="succeeded", params={"source_project_id": "p", "map_id": "m"}))
    items = client.get(f"{BASE}/{project_id}/jobs").json()["items"]
    assert [j["type"] for j in items] == ["map_move"]


# The body the interim frontend still sends until SH lands: a kind and classes, no type_ids.
OLD_CLIENT_BODY = {"name": "A", "kind": "detect", "classes": [{"name": "x", "colour": "#ff0000"}]}


def test_a_project_has_no_kind(client, settings, tmp_path):
    r = client.post(BASE, json={"name": "A", "folder": str(tmp_path / "a"), "type_ids": []})
    assert r.status_code == 201, r.text
    created = r.json()
    assert "kind" not in created
    assert "kind" not in client.get(f"{BASE}/{created['id']}").json()
    assert all("kind" not in p for p in client.get(BASE).json()["items"])
    recent = json.loads((settings.data_dir / "recent_projects.json").read_text("utf-8"))
    assert recent[0]["id"] == created["id"] and "kind" not in recent[0]


def test_create_takes_type_ids_and_starts_with_no_classes(client, tmp_path):
    body = {"name": "A", "folder": str(tmp_path / "a"), "type_ids": ["t-1", "t-2"]}
    r = client.post(BASE, json=body)
    assert r.status_code == 201, r.text
    assert r.json()["classes"] == []


def test_an_old_client_create_body_is_not_refused(client, tmp_path):
    r = client.post(BASE, json={**OLD_CLIENT_BODY, "folder": str(tmp_path / "old")})
    assert r.status_code == 201, r.text
    assert "kind" not in r.json() and r.json()["classes"] == []


def test_recent_entries_written_with_a_kind_still_list(client, settings, tmp_path):
    pid = client.post(BASE, json={"name": "A", "folder": str(tmp_path / "a"), "type_ids": []}).json()["id"]
    path = settings.data_dir / "recent_projects.json"
    entries = json.loads(path.read_text("utf-8"))
    path.write_text(json.dumps([{**e, "kind": "detect"} for e in entries]), "utf-8")
    assert [p["id"] for p in client.get(BASE).json()["items"]] == [pid]
    client.post(f"{BASE}/open", json={"folder": str(tmp_path / "a")})
    assert "kind" not in json.loads(path.read_text("utf-8"))[0]
