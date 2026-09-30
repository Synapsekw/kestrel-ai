"""R9-I image-anchor figure (reports spec §7.3 main snapshot, §9.1 image_crop, §9.2)."""

import pytest
from findings_helpers import insert_cloud
from reports_image_rows import image_finding, make_ctx, row_of

from app.db.models import Box
from app.findings import service
from app.findings.anchors import AnchorIn
from app.geometry import corners_of
from app.reports.figures import image
from app.reports.snapshots.keys import snapshot_key


def _main(handle, crack, make_jpeg, **kw):
    f, image_id, box_id = image_finding(handle, crack["id"], make_jpeg, **kw)
    figs = image.finding_figures(make_ctx(handle, context_inset=True), row_of(handle, f.id))
    assert len(figs) == 1
    return f, image_id, box_id, figs[0]


def test_a_box_is_one_4_by_3_crop_with_label_colour_and_key(handle, crack, make_jpeg):
    f, image_id, _, fig = _main(handle, crack, make_jpeg)
    spec = fig.snapshot.spec
    assert spec.kind == "image_crop" and spec.image_id == image_id
    assert [list(p) for p in spec.ring] == [[700, 500], [900, 500], [900, 650], [700, 650]]
    assert spec.colour.lower() == "#ff5a4f"  # the crack fixture's colour
    assert spec.label == f"F-{f.number:04d} · crack"
    assert spec.context == 3.0 and list(spec.out) == [1200, 900] and spec.inset is True
    assert (fig.snapshot.width_px, fig.snapshot.height_px) == (1200, 900)
    assert (fig.width_mm, fig.height_mm) == (140, 105)
    assert fig.caption == "a.jpg"
    assert fig.snapshot.key == snapshot_key(handle, spec)


def test_a_rotated_box_uses_its_corners(handle, crack, make_jpeg):
    _, _, _, fig = _main(handle, crack, make_jpeg, shape="rbox", angle=30.0)
    expected = [c for p in corners_of(700.0, 500.0, 200.0, 150.0, 30.0) for c in p]
    # alignment.md: ring_of rounds to 0.1 px, so an abs tolerance (not the default relative one);
    # flattened, since pytest.approx does not recurse into a list of tuples.
    actual = [c for p in fig.snapshot.spec.ring for c in p]
    assert actual == pytest.approx(expected, abs=0.06)


def test_a_polygon_uses_its_ring(handle, crack, make_jpeg):
    ring = [[10.0, 10.0], [300.0, 20.0], [150.0, 200.0]]
    _, _, _, fig = _main(
        handle, crack, make_jpeg, shape="polygon", xywh=(10.0, 10.0, 290.0, 190.0), points=ring
    )
    assert [list(p) for p in fig.snapshot.spec.ring] == ring


def test_a_point_is_a_one_vertex_ring(handle, crack, make_jpeg):
    _, _, _, fig = _main(handle, crack, make_jpeg, shape="point", xywh=(420.0, 330.0, 0.0, 0.0))
    assert [list(p) for p in fig.snapshot.spec.ring] == [[420.0, 330.0]]


def test_context_inset_false_turns_the_inset_off(handle, crack, make_jpeg):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    (fig,) = image.finding_figures(make_ctx(handle, context_inset=False), row_of(handle, f.id))
    assert fig.snapshot.spec.inset is False


def test_a_moved_box_changes_the_key(handle, crack, make_jpeg):
    f, _, box_id, before = _main(handle, crack, make_jpeg)
    with handle.session() as s:
        s.get(Box, box_id).x = 720.0
    (after,) = image.finding_figures(make_ctx(handle, context_inset=True), row_of(handle, f.id))
    assert after.snapshot.key != before.snapshot.key


def test_a_cloud_finding_has_no_image_figure(handle, crack):
    cloud = insert_cloud(handle)
    f = service.create_finding(
        handle, type_id=crack["id"], anchor=AnchorIn(kind="cloud", cloud_id=cloud, x=0.0, y=0.0, z=0.0)
    )
    assert image.finding_figures(make_ctx(handle), row_of(handle, f.id)) == []


def test_a_vanished_finding_yields_no_figure_and_no_error(handle, crack, make_jpeg):
    """`ck_finding_anchor` ties an image anchor's `annotation_id` to its `Finding` row (a box can
    never vanish under a surviving finding: `app.findings.annotations.on_box_deleting` deletes the
    finding along with its box), so the race spec §16 guards against is the finding itself going
    between paging and this call - re-reading it fresh (Ruling R-B) must not raise."""
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    row = row_of(handle, f.id)
    with handle.session() as s:
        from app.db.models import Finding

        s.delete(s.get(Finding, f.id))
    assert image.finding_figures(make_ctx(handle), row) == []


def test_moving_a_box_changes_the_finding_pages_fingerprint(handle, crack, make_jpeg):
    """Ruling R-A: moving a box does not bump `Finding.updated_at`, so the section fingerprint needs
    `image.fingerprint(ctx)` (max `Box.updated_at` + count over the boxes that anchor image findings)
    to notice the ring moved."""
    from app.reports.sections import finding_pages

    _, _, box_id = image_finding(handle, crack["id"], make_jpeg)
    ctx = make_ctx(handle)
    before = finding_pages.fingerprint(ctx)
    with handle.session() as s:
        s.get(Box, box_id).x = 720.0
    after = finding_pages.fingerprint(ctx)
    assert before != after
