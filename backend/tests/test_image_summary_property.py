"""Image inspection spec §17 "Summary": random sequences of create, update, review and delete leave
`image_summary` equal to a recompute from `box` (plan I-BX Task 7)."""

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from image_summary_helpers import expected_summary, new_image, stored_summary
from sqlalchemy import delete

from app.db.models import Box

API = "/api/v1"

OPS = st.lists(
    st.one_of(
        st.tuples(st.just("create"), st.integers(0, 2)),  # 2 = the defect type (crack)
        st.tuples(st.just("propose"), st.floats(0.05, 0.99)),
        st.tuples(st.just("patch"), st.integers(0, 50)),
        st.tuples(st.just("review"), st.sampled_from(["accept", "reject", "unreview"]), st.integers(0, 50)),
        st.tuples(st.just("delete"), st.integers(0, 50)),
        st.tuples(st.just("mark_empty"), st.booleans()),
        st.tuples(st.just("replace_proposals"), st.integers(0, 3)),
    ),
    min_size=1,
    max_size=20,
)


def _box_id(body: dict) -> str:
    """A kept-path create answers `Box` (before I-BA) or the flat `BoxWriteResult` (after; I-C0 ruling 1)."""
    return body["box"]["id"] if "box" in body else body["id"]


@pytest.fixture
def types(project, crack):
    return [c["id"] for c in project["classes"]][:2] + [crack["id"]]


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(ops=OPS)
def test_summary_equals_a_recompute_after_every_step(client, project, handle, types, ops):
    pid = project["id"]
    image_id = new_image(handle)
    boxes: list[str] = []

    def pick(n):
        return boxes[n % len(boxes)] if boxes else None

    for op in ops:
        kind = op[0]
        if kind == "create":
            r = client.post(
                f"{API}/projects/{pid}/images/{image_id}/boxes",
                json={"class_id": types[op[1]], "x": 10, "y": 10, "w": 20, "h": 20},
            )
            assert r.status_code == 201, r.text
            boxes.append(_box_id(r.json()))
        elif kind == "propose":
            with handle.session() as s:
                row = Box(
                    image_id=image_id,
                    class_id=types[1],
                    x=5,
                    y=5,
                    w=9,
                    h=9,
                    confidence=op[1],
                    provenance_kind="local_model",
                    review_state="unreviewed",
                )
                s.add(row)
                s.flush()
                boxes.append(row.id)
        elif kind == "patch" and pick(op[1]):
            r = client.patch(f"{API}/projects/{pid}/boxes/{pick(op[1])}", json={"x": 30})
            assert r.status_code in (200, 404), r.text
        elif kind == "review" and pick(op[2]):
            r = client.post(
                f"{API}/projects/{pid}/boxes/review", json={"box_ids": [pick(op[2])], "action": op[1]}
            )
            assert r.status_code in (200, 409), r.text  # 409 finding_has_content after I-BA
        elif kind == "delete" and pick(op[1]):
            gone = pick(op[1])
            r = client.delete(f"{API}/projects/{pid}/boxes/{gone}")
            assert r.status_code in (204, 404), r.text
            boxes.remove(gone)
        elif kind == "mark_empty":
            r = client.post(
                f"{API}/projects/{pid}/images/bulk-mark-empty",
                json={"image_ids": [image_id], "marked_empty": op[1]},
            )
            assert r.status_code == 200, r.text
        elif kind == "replace_proposals":
            # The `infer` write: drop pending proposals with an ORM bulk DELETE, then add n new ones.
            with handle.session() as s:
                s.execute(delete(Box).where(Box.image_id == image_id, Box.review_state == "unreviewed"))
                for n in range(op[1]):
                    s.add(
                        Box(
                            image_id=image_id,
                            class_id=types[0],
                            x=1,
                            y=1,
                            w=3,
                            h=3,
                            confidence=0.2 + 0.1 * n,
                            provenance_kind="local_model",
                            review_state="unreviewed",
                        )
                    )
        # a box removed by a finding or proposal delete is simply gone from `box`: no bookkeeping needed
        assert stored_summary(handle, image_id) == expected_summary(handle, image_id), op
