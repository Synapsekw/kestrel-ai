"""Volume measurements through the API and the volume_calc job (spec §6.8-6.10, §8, §13)."""

import io
import math
from pathlib import Path

import numpy as np
import pytest
import shapely
from PIL import Image as PILImage
from pyproj import CRS, Transformer
from rasterio.windows import Window
from shapely import affinity
from shapely.geometry import box
from sqlalchemy import select
from surfaces import CX, CY, EPSG, WKT, X0, Y1, circle, cone, cone_cloud, fixture_spec, plane, write_cloud
from volume_rows import add_cloud, add_map_run, add_surface

from app.db.models import Job, MapDetection, MapRun, Surface, VolumeMeasurement
from app.detect.review import review_map_detections
from app.surfaces.grid import open_surface
from app.surfaces.tiles import diff_colours
from app.volumes import jobs_calc, service
from app.volumes.paths import diff_path, measurement_dir
from app.volumes.schemas import VolumeResults
from app.volumes.startup import sweep_interrupted

BASE = "/api/v1/projects"
CONE = math.pi * 100 * 5 / 3
MACHINE = affinity.rotate(box(CX + 4 - 1.5, CY + 2 - 1.0, CX + 4 + 1.5, CY + 2 + 1.0), 33.0)


@pytest.fixture
def project_kind() -> str:
    return "detect"


@pytest.fixture
def top(handle):
    return add_surface(handle, fixture_spec(0.1), lambda x, y: plane(x, y) + cone(x, y), name="April")


@pytest.fixture
def measure(client, wait_job, project_id):
    def _measure(top_id, *, ring=None, base=None, **extra):
        body = {
            "name": extra.pop("name", "Pile 1"),
            "polygon_native": ring or circle(CX, CY, 12.0, 128),
            "top_surface_id": top_id,
            "base": base or {"kind": "toe_plane"},
            **extra,
        }
        r = client.post(f"{BASE}/{project_id}/volumes", json=body)
        assert r.status_code == 202, r.text
        job = wait_job(project_id, r.json()["job"]["id"])
        got = client.get(f"{BASE}/{project_id}/volumes/{r.json()['measurement']['id']}").json()
        return got, job

    return _measure


def _building_surface(handle) -> str:
    with handle.session() as s:
        row = Surface(name="Unfinished", kind="cloud_dsm", status="building")
        s.add(row)
        s.flush()
        return row.id


def test_create_calculates_and_results_match_the_contract(client, project_id, handle, top, measure):
    m, job = measure(top)
    assert job["state"] == "succeeded", job
    assert m["status"] == "ready" and m["stale_reasons"] == []
    r = m["results"]
    VolumeResults.model_validate(r)  # extra keys are forbidden: drift from the contract fails here
    assert r["fill_m3"] == pytest.approx(CONE, rel=0.001)
    assert r["top_surface"]["name"] == "April" and r["base_surface"] is None
    assert r["engine_version"] >= 1 and len(r["inputs_fingerprint"]) == 64
    assert m["masks"] == {
        "detection_run_ids": [],
        "class_ids": None,
        "buffer_m": 1.0,
        "exclusion_polygons": [],
    }
    assert job["result"] == {"measurement_id": m["id"], "net_m3": pytest.approx(r["net_m3"])}
    assert diff_path(handle, m["id"]).is_file()


def test_patch_makes_it_stale_and_a_name_only_patch_does_not(client, project_id, top, measure):
    m, _ = measure(top)
    url = f"{BASE}/{project_id}/volumes/{m['id']}"
    assert client.patch(url, json={"name": "Pile A"}).json()["status"] == "ready"
    got = client.patch(url, json={"base": {"kind": "flat", "z": 50.0}}).json()
    assert got["status"] == "stale" and "base changed" in got["stale_reasons"]
    back = client.patch(
        url,
        json={
            k: m["results"]["inputs"][k]
            for k in ("polygon_native", "top_surface_id", "base", "masks", "alignment")
        },
    )
    # "Revert to last calculated inputs" restores the fingerprint, and with it the results
    assert back.json()["stale_reasons"] == [] and back.json()["status"] == "ready"
    assert client.get(url).json()["status"] == "ready"


def test_base_is_normalised_to_its_kind(client, project_id, handle, top, measure):
    m, _ = measure(top, base={"kind": "toe_plane", "z": 12.0, "surface_id": "stray"})
    assert m["base"] == {"kind": "toe_plane", "z": None, "surface_id": None}
    url = f"{BASE}/{project_id}/volumes/{m['id']}"
    got = client.patch(url, json={"base": {"kind": "flat", "z": 50.0, "surface_id": top}}).json()
    assert got["base"] == {"kind": "flat", "z": 50.0, "surface_id": None}
    other = add_surface(handle, fixture_spec(0.1), plane, name="March")
    got = client.patch(url, json={"base": {"kind": "surface", "z": 3.0, "surface_id": other}}).json()
    assert got["base"] == {"kind": "surface", "z": None, "surface_id": other}


def test_surfaces_that_are_not_ready_are_409_not_ready(client, project_id, handle, top, measure):
    unfinished = _building_surface(handle)
    url = f"{BASE}/{project_id}/volumes"
    body = {
        "name": "x",
        "polygon_native": circle(CX, CY, 12.0),
        "top_surface_id": unfinished,
        "base": {"kind": "toe_plane"},
    }
    r = client.post(url, json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"
    m, _ = measure(top)
    r = client.patch(f"{url}/{m['id']}", json={"base": {"kind": "surface", "surface_id": unfinished}})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"


def test_a_deleted_mask_run_makes_it_stale_and_the_recalculation_names_it(
    client, wait_job, project_id, handle, top, measure
):
    gt = [CX - 50, 0.05, 0.0, CY + 50, 0.0, -0.05]
    _, run_id, _ = add_map_run(handle, crs_wkt=WKT, geotransform=gt, boxes=[])
    m, _ = measure(top, masks={"detection_run_ids": [run_id]})
    assert m["status"] == "ready"
    with handle.session() as s:
        s.delete(s.get(MapRun, run_id))
    got = client.get(f"{BASE}/{project_id}/volumes/{m['id']}").json()
    assert got["status"] == "stale" and got["stale_reasons"] == ["masks: detection run deleted"]
    r = client.post(f"{BASE}/{project_id}/volumes/{m['id']}/calculate")
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "failed" and "no longer exists" in job["error"]
    assert client.get(f"{BASE}/{project_id}/volumes/{m['id']}").json()["status"] == "stale"


def test_calculating_rows_refuse_changes_and_the_sweep_resets_them(client, project_id, handle, top):
    with handle.session() as s:
        fresh = VolumeMeasurement(
            name="New",
            polygon_native=circle(CX, CY, 12.0),
            top_surface_id=top,
            base={"kind": "toe_plane"},
            masks={},
            alignment={},
            status="calculating",
            job_id="gone",
        )
        old = VolumeMeasurement(
            name="Old",
            polygon_native=circle(CX, CY, 12.0),
            top_surface_id=top,
            base={"kind": "toe_plane"},
            masks={},
            alignment={},
            status="calculating",
            job_id="gone",
            results={"fill_m3": 1.0},
        )
        s.add_all([fresh, old])
        s.flush()
        ids = fresh.id, old.id
    url = f"{BASE}/{project_id}/volumes/{ids[0]}"
    for r in (
        client.patch(url, json={"base": {"kind": "flat", "z": 1.0}}),
        client.delete(url),
        client.post(f"{url}/calculate"),
    ):
        assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"

    class Runner:
        def is_live(self, job_id):
            return False

    assert sorted(sweep_interrupted(handle, Runner())) == sorted(ids)
    with handle.session() as s:
        assert s.get(VolumeMeasurement, ids[0]).status == "failed"
        assert s.get(VolumeMeasurement, ids[1]).status == "stale"


def _ended_job(handle, state="cancelled") -> str:
    with handle.session() as s:
        job = Job(type="volume_calc", params={}, state=state)
        s.add(job)
        s.flush()
        return job.id


def test_a_queued_job_cancelled_before_it_starts_reads_back_failed_or_stale(
    client, project_id, handle, top, measure
):
    """The runner never calls `run_volume_calc` for a cancelled queued job; the read settles it."""
    m, _ = measure(top)
    ended = _ended_job(handle), _ended_job(handle)
    with handle.session() as s:
        fresh = VolumeMeasurement(
            name="New",
            polygon_native=circle(CX, CY, 12.0),
            top_surface_id=top,
            base={"kind": "toe_plane"},
            masks={},
            alignment={},
            status="calculating",
            job_id=ended[0],
        )
        s.add(fresh)
        s.flush()
        fresh_id = fresh.id
        old = s.get(VolumeMeasurement, m["id"])
        old.status, old.job_id = "calculating", ended[1]
    got = client.get(f"{BASE}/{project_id}/volumes/{fresh_id}").json()
    assert got["status"] == "failed" and got["error"] == service.ENDED_BEFORE_START
    assert client.get(f"{BASE}/{project_id}/volumes/{m['id']}").json()["status"] == "stale"


def test_a_recalculation_whose_previous_job_ended_stays_calculating(handle, top, measure):
    """Between marking the row and recording the new job, a read must not settle it back."""
    m, job = measure(top)
    assert job["state"] == "succeeded"
    seen = []

    def submit():
        seen.append(service.get_measurement(handle, m["id"])[0].status)
        with handle.session() as s:
            new = Job(type="volume_calc", params={}, state="queued")
            s.add(new)
            s.flush()
            s.expunge(new)
        return new

    out, _ = service.start_calculation(handle, m["id"], submit)
    assert seen == ["calculating"] and out.status == "calculating"


def test_a_submit_that_raises_puts_the_row_back(client, project_id, handle, top, measure, monkeypatch):
    m, _ = measure(top)

    def boom():
        raise RuntimeError("queue is closed")

    with pytest.raises(RuntimeError):
        service.start_calculation(handle, m["id"], boom)
    got = client.get(f"{BASE}/{project_id}/volumes/{m['id']}").json()
    assert got["status"] == "ready" and got["job_id"] == m["job_id"]

    monkeypatch.setattr(client.app.state.jobs, "submit", lambda *a, **k: boom())
    body = {
        "name": "Queued never",
        "polygon_native": circle(CX, CY, 12.0),
        "top_surface_id": top,
        "base": {"kind": "toe_plane"},
    }
    with pytest.raises(RuntimeError):
        client.post(f"{BASE}/{project_id}/volumes", json=body)
    with handle.session() as s:
        row = s.execute(
            select(VolumeMeasurement).where(VolumeMeasurement.name == "Queued never")
        ).scalar_one()
        assert row.status == "failed" and "could not be queued" in row.error


def test_patch_refuses_nulls_and_an_empty_body(client, project_id, top, measure):
    m, _ = measure(top)
    url = f"{BASE}/{project_id}/volumes/{m['id']}"
    for body in ({}, {"base": None}, {"name": None}, {"top_surface_id": None, "name": "x"}):
        r = client.patch(url, json=body)
        assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error", body
    assert client.get(url).json()["name"] == "Pile 1"


def test_a_diff_that_cannot_be_replaced_keeps_the_old_results(
    client, wait_job, project_id, handle, top, measure, monkeypatch
):
    m, _ = measure(top)
    before = diff_path(handle, m["id"]).read_bytes()

    real_replace = jobs_calc.os.replace

    def locked(src, dst):  # only the final rename is blocked; the grid writer's own rename is not
        if Path(dst).name != "diff.tif":
            return real_replace(src, dst)
        raise PermissionError(13, "in use by a tile reader", str(dst))

    monkeypatch.setattr(jobs_calc.os, "replace", locked)
    monkeypatch.setattr(jobs_calc, "REPLACE_WAIT_S", 0.0)
    client.patch(f"{BASE}/{project_id}/volumes/{m['id']}", json={"base": {"kind": "flat", "z": 50.0}})
    r = client.post(f"{BASE}/{project_id}/volumes/{m['id']}/calculate")
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "failed" and "could not be saved" in job["error"]
    got = client.get(f"{BASE}/{project_id}/volumes/{m['id']}").json()
    assert got["status"] == "stale" and got["results"] == m["results"]
    assert diff_path(handle, m["id"]).read_bytes() == before
    assert not list(measurement_dir(handle, m["id"]).glob("diff-*.tif"))


def test_delete_removes_the_files_and_frees_the_surface(client, project_id, handle, top, measure):
    m, _ = measure(top)
    assert measurement_dir(handle, m["id"]).is_dir()
    r = client.delete(f"{BASE}/{project_id}/surfaces/{top}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert client.delete(f"{BASE}/{project_id}/volumes/{m['id']}").status_code == 204
    assert not measurement_dir(handle, m["id"]).exists()
    assert client.get(f"{BASE}/{project_id}/volumes/{m['id']}").status_code == 404
    assert client.delete(f"{BASE}/{project_id}/surfaces/{top}").status_code == 204


def test_validation_is_checked_after_the_lookups(client, project_id, handle, top):
    url = f"{BASE}/{project_id}/volumes"
    body = {
        "name": "x",
        "polygon_native": circle(CX, CY, 12.0),
        "top_surface_id": "nope",
        "base": {"kind": "flat"},
    }
    assert client.post(url, json=body).status_code == 404
    body["top_surface_id"] = top
    r = client.post(url, json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_base"
    far = circle(CX + 500, CY, 12.0)
    r = client.post(url, json={**body, "base": {"kind": "toe_plane"}, "polygon_native": far})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_geometry"


def test_changing_the_top_to_another_crs_is_refused(client, project_id, handle, top, measure):
    m, _ = measure(top)
    other = add_surface(handle, fixture_spec(0.1, crs_wkt=CRS.from_epsg(32638).to_wkt(), epsg=32638), plane)
    r = client.patch(f"{BASE}/{project_id}/volumes/{m['id']}", json={"top_surface_id": other})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_base"


def test_closed_ring_is_accepted(top, measure):
    """Review focus 5: OpenLayers sends the closing vertex."""
    ring = circle(CX, CY, 12.0)
    m, _ = measure(top, ring=ring + [ring[0]])
    assert m["results"]["fill_m3"] == pytest.approx(CONE, rel=0.001)


def test_diff_tile_pixel_equals_a_direct_diff_read(client, project_id, handle, top, measure):
    m, _ = measure(top)
    url = f"{BASE}/{project_id}/volumes/{m['id']}/diff-tiles/2/1/1?v={m['results']['computed_at']}"
    r = client.get(url)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    got = np.asarray(PILImage.open(io.BytesIO(r.content)).convert("RGBA"))
    spec = fixture_spec(0.1)
    with open_surface(diff_path(handle, m["id"])) as d:
        dc = round((d.spec.x0 - spec.x0) / 0.1)
        dr = round((spec.y0 - d.spec.y0) / 0.1)
        dz = d.read(Window(256 - dc, 256 - dr, 256, 256), boundless=True).astype(np.float64)
    assert np.array_equal(got, diff_colours(dz, m["results"]["diff_scale_m"]))


def test_diff_tiles_before_results_are_409_not_ready(client, project_id, handle, top):
    with handle.session() as s:
        row = VolumeMeasurement(
            name="n",
            polygon_native=circle(CX, CY, 12.0),
            top_surface_id=top,
            base={"kind": "toe_plane"},
            masks={},
            alignment={},
            status="failed",
        )
        s.add(row)
        s.flush()
        mid = row.id
    r = client.get(f"{BASE}/{project_id}/volumes/{mid}/diff-tiles/0/0/0")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"


def _ll_map_with_machine(handle):
    to_ll = Transformer.from_crs(EPSG, 4326, always_xy=True)
    lon0, lat1 = to_ll.transform(CX - 50, CY + 50)
    lon1, lat0 = to_ll.transform(CX + 50, CY - 50)
    px, py = (lon1 - lon0) / 4000, (lat1 - lat0) / 4000
    mx0, my0, mx1, my1 = MACHINE.bounds
    lons, lats = to_ll.transform([mx0, mx1], [my1, my0])
    pixel_box = (
        (lons[0] - lon0) / px,
        (lat1 - lats[0]) / py,
        (lons[1] - lons[0]) / px,
        (lats[0] - lats[1]) / py,
    )
    return add_map_run(
        handle,
        crs_wkt=CRS.from_epsg(4326).to_wkt(),
        geotransform=[lon0, px, 0.0, lat1, 0.0, -py],
        boxes=[pixel_box],
    )


def test_machine_detected_on_a_4326_map_is_masked_and_shown(client, project_id, handle, measure):
    def with_machine(x, y):
        z = plane(x, y) + cone(x, y)
        return np.where(shapely.contains_xy(MACHINE, x, y), z + 2.5, z)

    top = add_surface(handle, fixture_spec(0.1), with_machine)
    map_id, run_id, _ = _ll_map_with_machine(handle)
    bare, _ = measure(top, name="bare")
    masked, _ = measure(top, name="masked", masks={"detection_run_ids": [run_id], "buffer_m": 0.5})
    assert bare["results"]["fill_m3"] == pytest.approx(CONE + 15.0, rel=0.01)
    # the box is axis-aligned around the rotated machine, so it masks a little more than the machine
    assert masked["results"]["fill_m3"] == pytest.approx(CONE, rel=0.005)
    assert masked["results"]["masked_area_m2"] > 6.0 and masked["results"]["footprints_used"] == 1
    assert "mask_other_flight" in {w["code"] for w in masked["results"]["warnings"]}
    fps = client.get(f"{BASE}/{project_id}/volumes/{masked['id']}/footprints").json()
    assert fps["truncated"] is False and len(fps["items"]) == 1 and fps["items"][0]["run_id"] == run_id
    assert map_id


def test_cloud_to_surface_to_volume_end_to_end(client, wait_job, project_id, handle, tmp_path, measure):
    """§7.2 last row: 100 pts/m², σ 3 cm, 0.1 % outliers -> median at the auto cell -> within 0.6 %."""
    cloud = add_cloud(handle, write_cloud(tmp_path / "c.las", cone_cloud(100, 0.03, 0.001)), crs_wkt=WKT)
    r = client.post(f"{BASE}/{project_id}/surfaces", json={"point_cloud_id": cloud})
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    m, job = measure(r.json()["surface"]["id"])
    assert job["state"] == "succeeded", job
    assert m["results"]["fill_m3"] == pytest.approx(CONE, rel=0.006)
    assert m["results"]["top_surface"]["method"] == "median"


def test_surface_base_with_stable_area_and_shift(client, project_id, handle, measure):
    def cut_fill(x, y):
        ra = np.hypot(x - (CX - 12), y - (CY + 9))
        rb = np.hypot(x - (CX + 13), y - (CY - 8))
        return (
            plane(x, y) + np.where(ra < 8, 3 * (1 - ra / 8), 0) - np.where(rb < 6, 2 * (1 - rb / 6), 0) + 0.07
        )

    earlier = add_surface(handle, fixture_spec(0.25), plane, name="March")
    later = add_surface(handle, fixture_spec(0.25), cut_fill, name="April")
    whole = [[X0 + 1, Y1 - 1], [X0 + 59, Y1 - 1], [X0 + 59, Y1 - 50], [X0 + 1, Y1 - 50]]
    stable = [[X0 + 1, Y1 - 55], [X0 + 58, Y1 - 55], [X0 + 58, Y1 - 59], [X0 + 1, Y1 - 59]]
    m, _ = measure(
        later,
        ring=whole,
        base={"kind": "surface", "surface_id": earlier},
        alignment={"stable_polygon": stable, "apply_shift": True},
    )
    r = m["results"]
    assert r["shift_applied_m"] == pytest.approx(0.07, abs=0.001)
    assert r["net_m3"] == pytest.approx(201.062 - 75.398, rel=0.002)
    assert m["alignment"]["measured"]["median_dz"] == pytest.approx(0.07, abs=0.001)
    assert r["base_surface"]["name"] == "March" and r["uncertainty"]["complete"]
    # the base surface is in use through the JSON base.surface_id, not only top_surface_id
    r = client.delete(f"{BASE}/{project_id}/surfaces/{earlier}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"


def test_results_validate_against_the_contract_schema(top, measure):
    import jsonschema_rs  # schemathesis's validator; the pure-Python jsonschema is not installed
    import yaml

    spec = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
    m, _ = measure(top)
    components = yaml.safe_load(spec.read_text("utf-8"))["components"]
    schema = {"$ref": "#/components/schemas/VolumeMeasurement", "components": components}
    jsonschema_rs.Draft202012Validator(schema, validate_formats=True).validate(m)


def test_rejecting_or_reclassing_a_masked_detection_makes_it_stale(client, project_id, handle, top, measure):
    """Spec §6.10: what is masked changes when a person reviews the run's detections."""
    _, run_id, (det_id,) = _ll_map_with_machine(handle)
    m, _ = measure(top, masks={"detection_run_ids": [run_id]})
    url = f"{BASE}/{project_id}/volumes/{m['id']}"
    assert m["status"] == "ready" and m["results"]["footprints_used"] == 1
    review_map_detections(handle, run_id, [det_id], "accept")  # still masked: nothing changes
    assert client.get(url).json()["status"] == "ready"
    review_map_detections(handle, run_id, [det_id], "reject")
    got = client.get(url).json()
    assert got["status"] == "stale" and got["stale_reasons"] == ["masks: detection run changed"]
    review_map_detections(handle, run_id, [det_id], "unreview")
    assert client.get(url).json()["stale_reasons"] == []  # back on the inputs it was computed from
    with handle.session() as s:
        s.get(MapDetection, det_id).class_id = "c-dozer"
    assert client.get(url).json()["stale_reasons"] == ["masks: detection run changed"]


def test_a_local_base_under_a_georeferenced_top_is_422_invalid_base(client, project_id, handle, top, measure):
    local = add_surface(handle, fixture_spec(0.1, crs_wkt=None, epsg=None), plane, name="Local")
    body = {
        "name": "mix",
        "polygon_native": circle(CX, CY, 12.0),
        "top_surface_id": top,
        "base": {"kind": "surface", "surface_id": local},
    }
    r = client.post(f"{BASE}/{project_id}/volumes", json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_base"
    assert "local coordinates" in r.json()["error"]["message"]
    m, _ = measure(top)
    url = f"{BASE}/{project_id}/volumes/{m['id']}"
    r = client.patch(url, json={"base": {"kind": "surface", "surface_id": local}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_base"
    # spec §6.2: a georeferenced base in any other CRS is accepted (the job reprojects it)
    utm38 = add_surface(handle, fixture_spec(0.1, crs_wkt=CRS.from_epsg(32638).to_wkt(), epsg=32638), plane)
    r = client.patch(url, json={"base": {"kind": "surface", "surface_id": utm38}})
    assert r.status_code == 200 and r.json()["status"] == "stale"


def test_settle_keeps_what_the_job_wrote_after_the_row_was_read(handle, top, measure):
    """A compare-and-set on `calculating` and the same job: a row the job already settled, or one a
    new calculation took over, is not overwritten by the generic settle."""
    m, _ = measure(top)
    ended = _ended_job(handle)
    with handle.session() as s:
        row = s.get(VolumeMeasurement, m["id"])
        row.status, row.job_id = "calculating", ended
    with handle.session() as s:
        row = s.get(VolumeMeasurement, m["id"])  # read as `calculating` with an ended job
        with handle.session() as job_side:  # ... then the job settles it itself
            job_side.get(VolumeMeasurement, m["id"]).status = "ready"
        assert service._settle(s, row).status == "ready"
    with handle.session() as s:
        row = s.get(VolumeMeasurement, m["id"])
        row.status, row.job_id = "calculating", ended
    with handle.session() as s:
        row = s.get(VolumeMeasurement, m["id"])
        with handle.session() as other:  # a new calculation took the row over
            other.get(VolumeMeasurement, m["id"]).job_id = "new-job"
        settled = service._settle(s, row)
        assert (settled.status, settled.job_id) == ("calculating", "new-job")


def test_sweep_removes_measurement_folders_no_row_names(handle, top, measure):
    class Runner:
        def is_live(self, job_id):
            return False

    m, _ = measure(top)
    orphan = handle.volumes_dir / "deleted-measurement-id"
    orphan.mkdir(parents=True)
    (orphan / "diff.tif").write_bytes(b"x")
    sweep_interrupted(handle, Runner())
    assert not orphan.exists() and diff_path(handle, m["id"]).is_file()
