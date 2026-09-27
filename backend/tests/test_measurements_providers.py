"""One provider per kind: headline, unit, status and deep-link fields (plan maps-b4 Task 6;
rulings 11-12; R7's C-B1 extension point)."""

from types import SimpleNamespace

from data_rows import add_cloud, add_map, add_surface, at
from mapmeasure_rows import add_cloud_measurement, add_map_measurement, add_volume

from app.measurements import providers
from app.measurements.providers import CLOUD_HEADLINES, NO_HEADLINE, PROVIDERS, Headline


def _one(handle, kind, sub_kinds=None):
    with handle.session() as s:
        return PROVIDERS[kind].page(s, None, 10, sub_kinds)


def test_cloud_rows_map_their_headline_per_sub_kind(handle):
    cloud = add_cloud(handle)
    add_cloud_measurement(handle, cloud, kind="distance", results={"distance_3d": 4.25}, created_at=at(1))
    add_cloud_measurement(handle, cloud, kind="point", z=101.5, created_at=at(2))
    add_cloud_measurement(handle, cloud, kind="vertical", results={"lean_mm_per_m": 3.0}, created_at=at(3))
    add_cloud_measurement(handle, cloud, kind="height", results={"height_difference": -1.5}, created_at=at(4))
    items = _one(handle, "cloud")
    assert [(i.sub_kind, i.headline, i.unit) for i in items] == [
        ("height", -1.5, "m"),
        ("vertical", 3.0, "mm_per_m"),
        ("point", 101.5, "m"),
        ("distance", 4.25, "m"),
    ]
    assert {(i.kind, i.data_type, i.data_id, i.status) for i in items} == {
        ("cloud", "point_cloud", cloud, "ready")
    }


def test_an_unmapped_cloud_sub_kind_lists_with_no_headline(handle, monkeypatch):
    monkeypatch.delitem(CLOUD_HEADLINES, "distance")  # as C's `area`/`profile` are until C-B1
    add_cloud_measurement(handle, add_cloud(handle), results={"distance_3d": 4.0}, created_at=at(1))
    (item,) = _one(handle, "cloud")
    assert (item.headline, item.unit, item.status) == (None, None, "ready")


def test_the_c_b1_extension_point_is_one_dict_entry(monkeypatch):
    monkeypatch.setitem(CLOUD_HEADLINES, "area", lambda m: Headline(m.results.get("area_m2"), "m2"))
    area = SimpleNamespace(kind="area", results={"area_m2": 7.0})
    assert providers.cloud_headline(area) == Headline(7.0, "m2")
    assert providers.cloud_headline(SimpleNamespace(kind="not_a_kind", results={})) == NO_HEADLINE


def test_volume_rows(handle):
    top = add_surface(handle)
    ready = add_volume(handle, top, net=-12.5, created_at=at(1))
    busy = add_volume(handle, top, status="calculating", created_at=at(2))
    items = _one(handle, "volume")
    assert [(i.id, i.status, i.headline, i.unit) for i in items] == [
        (busy, "computing", None, None),
        (ready, "ready", -12.5, "m3"),
    ]
    assert {(i.sub_kind, i.data_type, i.data_id) for i in items} == {("volume", "elevation", top)}


def test_map_rows_fall_back_to_grid_values_and_pick_their_data_item(handle):
    m = add_map(handle)
    dsm = add_surface(handle)
    add_map_measurement(
        handle, kind="distance", map_id=m, results={"length_m": 40.1, "grid_length_m": 40.0}, created_at=at(1)
    )
    add_map_measurement(
        handle, kind="area", epsg=None, results={"area_m2": None, "grid_area_m2": 400.0}, created_at=at(2)
    )
    add_map_measurement(
        handle, kind="profile", surface_ids=(dsm,), results={"length_m": 12.0}, created_at=at(3)
    )
    items = _one(handle, "map")
    assert [(i.sub_kind, i.headline, i.unit, i.data_type, i.data_id, i.status) for i in items] == [
        ("profile", 12.0, "m", "elevation", dsm, "ready"),
        ("area", 400.0, "m2", None, None, "ready"),
        ("distance", 40.1, "m", "map", m, "ready"),
    ]


def test_a_disjoint_sub_kind_filter_skips_the_query(handle):
    add_volume(handle, add_surface(handle), net=1.0, created_at=at(1))
    assert _one(handle, "volume", ["distance"]) == []
    assert len(_one(handle, "volume", ["volume"])) == 1
