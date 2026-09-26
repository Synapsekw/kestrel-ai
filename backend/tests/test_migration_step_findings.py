"""Step 6 (accepted defect boxes become reviewed findings) and step 7 (counts), spec §11.4, D6, F4."""

import pytest
from migration_helpers import (
    add_images_and_boxes,
    add_many_boxes,
    at_revision,
    env_for,
    open_handle,
    open_stores,
    run_step,
)
from sqlalchemy import text

from app.findings.backfill import findings_from_annotations as create_findings
from app.migration import ports, steps
from app.migration.pipeline import Step, run_pipeline

CRACK = [{"id": "c-crack", "name": "crack", "colour": "#ef4444", "hotkey": None, "order": 0}]
UP_TO_TYPES = (steps.catalogue_merge, steps.rewrite_class_ids, steps.project_types)


@pytest.fixture
def stores(tmp_path):
    st = open_stores(tmp_path / "appdata")
    yield st
    st.close()


def _defect_type(stores, name="Crack") -> str:
    with stores.catalogue.session() as cs:
        type_id = ports.create_type(cs, name=name, colour="#ef4444", hotkey=None)
        cs.execute(text("UPDATE catalogue_type SET kind = 'defect' WHERE id = :id"), {"id": type_id})
    return type_id


def _project(tmp_path, stores, classes):
    folder = at_revision(tmp_path / "p", "0009", classes=classes)
    add_images_and_boxes(folder, classes=classes)
    h = open_handle(folder)
    env = env_for(stores, folder)
    for fn in UP_TO_TYPES:
        run_step(h, env, fn)
    return h, env


def _findings(h):
    with h.session() as s:
        return [
            dict(r)
            for r in s.execute(
                text(
                    "SELECT number, annotation_id, status, severity, created_by, lon, lat,"
                    " data_type, data_id, type_id FROM finding ORDER BY number"
                )
            ).mappings()
        ]


def test_object_types_create_no_findings(tmp_path, stores):
    h, env = _project(
        tmp_path,
        stores,
        [{"id": "c-exc", "name": "excavator", "colour": "#f97316", "hotkey": None, "order": 0}],
    )
    assert run_step(h, env, steps.findings_from_annotations) == {"findings_created": 0}
    assert _findings(h) == []


def test_accepted_edited_and_person_boxes_on_defect_types_become_numbered_findings(tmp_path, stores):
    crack = _defect_type(stores)
    h, env = _project(tmp_path, stores, CRACK)
    assert run_step(h, env, steps.findings_from_annotations) == {"findings_created": 3}
    found = _findings(h)
    assert [
        (f["number"], f["annotation_id"], f["status"], f["severity"], f["created_by"]) for f in found
    ] == [
        (1, "b-c-crack-0", "reviewed", None, "model:m-old"),
        (2, "b-c-crack-1", "reviewed", None, "model:m-old"),
        (3, "b-c-crack-2", "reviewed", None, "human"),
    ]
    assert [(f["lon"], f["lat"]) for f in found] == [(55.2, 25.1), (None, None), (55.2, 25.1)]
    assert {(f["data_type"], f["data_id"], f["type_id"]) for f in found} == {("image_set", "s1", crack)}


def test_batches_commit_as_they_go_and_a_rerun_creates_none(tmp_path, stores):
    crack = _defect_type(stores)
    h, env = _project(tmp_path, stores, CRACK)
    h.catalogue = stores.catalogue  # BC's function reads the catalogue through the handle
    progress = []
    created = create_findings(h, [crack], batch=2, progress=lambda done, total: progress.append(done))
    assert created == 3 and progress == [2, 3]
    assert create_findings(h, [crack], batch=2) == 0
    assert run_step(h, env, steps.findings_from_annotations) == {"findings_created": 0}
    assert [f["number"] for f in _findings(h)] == [1, 2, 3]


def test_counts_are_rebuilt_and_the_upgrade_is_logged_once(tmp_path, stores):
    _defect_type(stores)
    h, env = _project(tmp_path, stores, CRACK)
    run_step(h, env, steps.findings_from_annotations)
    assert run_step(h, env, steps.counts_rebuild) == {"findings": 3}
    run_step(h, env, steps.counts_rebuild)
    with h.session() as s:
        assert s.execute(text("SELECT SUM(n) FROM finding_count WHERE status = 'reviewed'")).scalar_one() == 3
        logged = s.execute(
            text("SELECT COUNT(*) FROM activity WHERE summary = 'Project upgraded'")
        ).scalar_one()
    assert logged == 1


def test_a_thousand_and_fifty_boxes_create_one_finding_each_through_the_pipeline(tmp_path, stores):
    """The >1000-box case (Task 9's bulk helper): BC's function batches at 1000, each batch in its
    own session; the ledger write for the findings step must follow those commits without holding a
    read snapshot across them, or SQLite raises "database is locked" (coordinator ruling)."""
    _defect_type(stores)
    folder = at_revision(tmp_path / "p", "0009", classes=CRACK)
    add_images_and_boxes(folder, classes=CRACK)
    add_many_boxes(folder, "c-crack", 1050)
    h = open_handle(folder)
    env = env_for(stores, folder)
    pipeline_steps = tuple(
        Step(fn.__name__, fn.__name__, fn) for fn in (*UP_TO_TYPES, steps.findings_from_annotations)
    )
    report = run_pipeline(h, env, pipeline_steps)
    findings_step = next(s for s in report["steps"] if s["name"] == "findings_from_annotations")
    assert findings_step["detail"] == {"findings_created": 1053}  # 3 from add_images_and_boxes + 1050 bulk
    with h.session() as s:
        assert s.execute(text("SELECT COUNT(*) FROM finding")).scalar_one() == 1053
        recorded = s.execute(
            text("SELECT COUNT(*) FROM migration_step WHERE name = 'findings_from_annotations'")
        ).scalar_one()
    assert recorded == 1
