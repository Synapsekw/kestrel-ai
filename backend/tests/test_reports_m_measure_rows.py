"""The measurements section's rows (reports spec §7.2 kind mapping; Ruling 8), paged over M's union."""

from data_rows import add_cloud, add_surface, at
from mapmeasure_rows import add_cloud_measurement, add_map_measurement, add_volume

from app.reports.sections import measure_rows


def _ids(handle, group, ids=None):
    return [i.id for page in measure_rows.iter_group_pages(handle, group, ids) for i in page]


def test_the_kind_mapping_is_the_specs(handle):
    cloud = add_cloud(handle)
    top = add_surface(handle)
    m_dist = add_map_measurement(handle, kind="distance", created_at=at(1), results={"length_m": 5.0})
    c_dist = add_cloud_measurement(handle, cloud, created_at=at(2), results={"distance_3d": 2.0})
    lean = add_cloud_measurement(handle, cloud, created_at=at(3), kind="vertical")
    height = add_cloud_measurement(handle, cloud, created_at=at(4), kind="height")
    m_area = add_map_measurement(handle, kind="area", created_at=at(5))
    m_prof = add_map_measurement(handle, kind="profile", created_at=at(6))
    point = add_cloud_measurement(handle, cloud, created_at=at(7), kind="point")
    vol = add_volume(handle, top, created_at=at(8), net=3.0)
    assert _ids(handle, "length") == [c_dist, m_dist]  # newest first
    assert _ids(handle, "lean") == [lean]
    assert _ids(handle, "height") == [height]
    assert _ids(handle, "area") == [m_area]
    assert _ids(handle, "profile") == [m_prof]
    assert _ids(handle, "volume") == [vol]
    every = {i for g in measure_rows.ORDER for i in _ids(handle, g)}
    assert point not in every  # a cloud point is not a report kind


def test_groups_page_across_the_boundary(handle, monkeypatch):
    monkeypatch.setattr(measure_rows, "PAGE", 3)
    made = [add_map_measurement(handle, kind="distance", created_at=at(i)) for i in range(7)]
    pages = list(measure_rows.iter_group_pages(handle, "length", None))
    assert [len(p) for p in pages] == [3, 3, 1]
    assert [i.id for p in pages for i in p] == list(reversed(made))


def test_measurement_ids_keep_only_those(handle):
    a = add_map_measurement(handle, kind="distance", created_at=at(1))
    add_map_measurement(handle, kind="distance", created_at=at(2))
    assert _ids(handle, "length", {a}) == [a]


def test_rows_carry_the_data_item_name_the_source_and_the_value(handle):
    cloud = add_cloud(handle)
    c = add_cloud_measurement(
        handle, cloud, created_at=at(1), kind="vertical", results={"lean_mm_per_m": 4.25}
    )
    [page] = list(measure_rows.iter_group_pages(handle, "lean", None))
    labels = measure_rows.data_labels(handle, page)
    row = measure_rows.table_row(page[0], labels)
    assert row[0] == "c" and row[1] == labels[page[0].data_id] and row[2] == "Cloud lean"
    assert row[3] == "4.2 mm/m" and row[4] == "ready" and row[5] == "1 Sep 2026"
    assert page[0].id == c


def test_value_texts():
    from datetime import UTC, datetime

    from app.measurements.schemas import MeasurementItem

    def item(**kw):
        base = dict(
            kind="map",
            sub_kind="area",
            id="x",
            name="n",
            headline=1234.5,
            unit="m2",
            data_type=None,
            data_id=None,
            status="ready",
            created_at=datetime(2026, 9, 1, tzinfo=UTC),
            updated_at=datetime(2026, 9, 1, tzinfo=UTC),
        )
        return MeasurementItem(**(base | kw))

    assert measure_rows.value_text(item()) == "1,234.50 m²"
    assert measure_rows.value_text(item(unit="m3", headline=3.0)) == "3.00 m³"
    assert measure_rows.value_text(item(headline=None, unit=None)) == "-"
    assert measure_rows.value_text(item(status="stale")) == "stale, recalculate"
    assert measure_rows.value_text(item(status="computing")) == "calculating"
    assert measure_rows.value_text(item(status="failed")) == "failed"
    assert measure_rows.value_text(item(), stale=True) == "stale, recalculate"
    # The Status column speaks the same words as the Value column (never the raw state).
    assert measure_rows.table_row(item(status="computing"), {})[3:5] == ["calculating", "calculating"]
    assert measure_rows.table_row(item(status="stale"), {})[4] == "stale, recalculate"
    assert measure_rows.table_row(item(), {}, stale=True)[4] == "stale, recalculate"
    assert measure_rows.table_row(item(), {})[4] == "ready"


def test_the_table_is_174_mm_wide_with_a_repeating_header():
    t = measure_rows.table([["a", "b", "c", "d", "e", "f"]])
    assert sum(c.width_mm for c in t.columns) == 174 and t.repeat_header is True
    assert [c.label for c in t.columns] == ["Name", "On", "Source", "Value", "Status", "Created"]
