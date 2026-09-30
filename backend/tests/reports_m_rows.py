"""Rows for the R9-M tests: georeferenced maps and a DEM (no file on disk: compose never opens a
raster), map measurements, map findings, map/photo runs, site areas, a ready volume, and a
ComposeContext over R2's `reports_rows` config helpers."""

from __future__ import annotations

from datetime import UTC, date, datetime

from pyproj import CRS

from app.db.models import (
    Finding,
    GeoMap,
    MapMeasurement,
    MapRun,
    QueryRun,
    SiteArea,
    Source,
    Surface,
    VolumeMeasurement,
)
from app.maps.georef import Georef

UTM33 = CRS.from_epsg(32633).to_wkt()
T0 = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)
GENERATED_AT = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)
Y0 = 4983000.0


def gt(x0: float) -> list[float]:
    """10 cm pixels: a 1000 px map is 100 m a side, its top-left at (x0, Y0) in UTM 33N."""
    return [x0, 0.1, 0.0, Y0, 0.0, -0.1]


def add_geomap(
    handle,
    *,
    name: str,
    captured_on: date | None = None,
    x0: float = 500000.0,
    status: str = "ready",
    size: int = 1000,
    created_at: datetime = T0,
) -> str:
    geo = Georef(gt(x0), UTM33)
    with handle.session() as s:
        row = GeoMap(
            name=name,
            status=status,
            source_path=f"D:/orthos/{name}.tif",
            source_size=1,
            width=size,
            height=size,
            geotransform=gt(x0),
            crs_wkt=UTM33,
            epsg=32633,
            bounds_native=geo.bounds_native(size, size),
            bounds_wgs84=geo.bounds_wgs84(size, size),
            captured_on=captured_on,
            created_at=created_at,
        )
        s.add(row)
        s.flush()
        return row.id


def add_dem(handle, *, name: str = "DSM 1 Sep", x0: float = 500000.0, status: str = "ready") -> str:
    with handle.session() as s:
        row = Surface(
            name=name,
            kind="dem",
            status=status,
            crs_wkt=UTM33,
            epsg=32633,
            cell_size_m=0.5,
            width=200,
            height=200,
            geotransform=[x0, 0.5, 0.0, Y0, 0.0, -0.5],
            bounds_native=[x0, Y0 - 100.0, x0 + 100.0, Y0],
            elevation_role="dsm",
        )
        s.add(row)
        s.flush()
        return row.id


def map_measurement(
    handle,
    *,
    kind: str,
    vertices: list[list[float]],
    map_id: str | None = None,
    surface_ids: tuple[str, ...] = (),
    results: dict | None = None,
    name: str = "M1",
    created_at: datetime = T0,
    crs_wkt: str | None = UTM33,
) -> str:
    with handle.session() as s:
        row = MapMeasurement(
            kind=kind,
            name=name,
            crs_wkt=crs_wkt,
            epsg=32633 if crs_wkt else None,
            geometry=vertices,
            surface_ids=list(surface_ids),
            map_id=map_id,
            results=results or {},
            created_at=created_at,
            updated_at=created_at,
        )
        s.add(row)
        s.flush()
        return row.id


def map_finding(
    handle,
    *,
    map_id: str,
    geometry: dict,
    number: int,
    type_id: str,
    lon: float | None = None,
    lat: float | None = None,
) -> str:
    with handle.session() as s:
        row = Finding(
            number=number,
            type_id=type_id,
            anchor_kind="map",
            map_id=map_id,
            geometry=geometry,
            lon=lon,
            lat=lat,
            data_type="map",
            data_id=map_id,
        )
        s.add(row)
        s.flush()
        return row.id


def cloud_finding_row(handle, *, number: int, type_id: str, lon: float | None, lat: float | None) -> str:
    """A cloud finding (the cloud row itself is not needed by R9-M's hooks)."""
    with handle.session() as s:
        row = Finding(
            number=number,
            type_id=type_id,
            anchor_kind="cloud",
            cloud_id="cloud-x",
            x=1.0,
            y=2.0,
            z=3.0,
            lon=lon,
            lat=lat,
            data_type="point_cloud",
            data_id="cloud-x",
        )
        s.add(row)
        s.flush()
        return row.id


def map_run(
    handle,
    *,
    map_id: str,
    counts: dict,
    verified: dict | None = None,
    area_counts: dict | None = None,
    model_id: str = "mod",
    conf: float = 0.25,
    created_at: datetime = T0,
) -> str:
    with handle.session() as s:
        row = MapRun(
            map_id=map_id,
            kind="local_model",
            model_id=model_id,
            model_name=model_id,
            conf=conf,
            counts=counts,
            verified_counts=verified or {},
            area_counts=area_counts or {},
            created_at=created_at,
        )
        s.add(row)
        s.flush()
        return row.id


def site_area(handle, *, name: str, px: tuple[int, int, int, int], x0: float = 500000.0) -> str:
    """A site area over map pixels (x0, y0, x1, y1) of a map at `x0`."""
    geo = Georef(gt(x0), UTM33)
    a, b, c, d = px
    ring = [list(geo.pixel_to_wgs84(x, y)) for x, y in ((a, b), (c, b), (c, d), (a, d))]
    with handle.session() as s:
        row = SiteArea(name=name, polygon_wgs84=ring, created_at=T0)
        s.add(row)
        s.flush()
        return row.id


def photo_batch(
    handle, *, label: str, captured_on: date | None, counts: dict | None, verified: dict | None = None
) -> str:
    """A photo source; with `counts`, one detection run over it (counts are detections)."""
    with handle.session() as s:
        src = Source(
            folder=f"D:/photos/{label}", site=label, kind="images", label=label, captured_on=captured_on
        )
        s.add(src)
        s.flush()
        if counts is not None:
            s.add(
                QueryRun(
                    kind="local_model",
                    model_id="mod",
                    model_name="mod",
                    source_id=src.id,
                    counts=counts,
                    verified_counts=verified or {},
                    created_at=T0,
                )
            )
        return src.id


def ready_volume(handle, surface_id: str, *, name: str = "Pile 1", net: float = 12.5) -> str:
    """A `ready` volume whose stored fingerprint matches its current inputs (not stale)."""
    from app.volumes.service import fingerprint, inputs_snapshot

    with handle.session() as s:
        row = VolumeMeasurement(
            name=name,
            polygon_native=[[500010.0, 4982990.0], [500020.0, 4982990.0], [500020.0, 4982980.0]],
            top_surface_id=surface_id,
            base={"kind": "toe_plane"},
            status="ready",
            created_at=T0,
            updated_at=T0,
        )
        s.add(row)
        s.flush()
        inputs = inputs_snapshot(s, row)
        row.results = {
            "fill_m3": net + 1.0,
            "cut_m3": 1.0,
            "net_m3": net,
            "area_m2": 50.0,
            "uncertainty": {"total_m3": 0.4},
            "top_surface": {"name": "DSM 1 Sep"},
            "base_surface": None,
            "computed_at": "2026-09-02T10:00:00+00:00",
            "inputs": inputs,
            "inputs_fingerprint": fingerprint(inputs),
        }
        return row.id


def make_ctx(handle, key: str | None = None, **options):
    """A ComposeContext built through R2's `reports_rows` helpers (controller Ruling P2, so every
    composer meets R2's real `config`/`fake_key`/clock): `options` override section `key`'s. With
    `key=None`, no section is enabled, but `ctx.types`/`ctx.level` still resolve normally."""
    from reports_rows import config, ctx_for

    cfg = config(sections=(key,) if key else (), options={key: options} if key else None)
    return ctx_for(handle, cfg)


def row_of(handle, finding_id: str):
    """The FindingRow `make_ctx`'s iterator would yield for `finding_id`: built through a real
    ComposeContext so type name/colour and severity resolve from the catalogue, not R2's
    ctx-less fallback."""
    from app.reports.compose import FindingRow

    with handle.session() as s:
        return FindingRow.from_finding(s.get(Finding, finding_id), make_ctx(handle))
