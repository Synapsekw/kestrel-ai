"""Foundation F0 of the point-cloud, volumes and design-surface specs: the shared scaffolding.

Project folders, the four startup sweeps, the change events, the selftest placeholders and the
PotreeConverter seam with its offline stand-in.
"""

import importlib
import logging
from types import SimpleNamespace

import pytest
from pointclouds import fake_run_converter, make_las, read_fake_octree

from app.__main__ import run
from app.events_util import publish_pointclouds_changed, publish_surfaces_changed, publish_volumes_changed
from app.main import project_opened
from app.pointclouds import converter

SWEEP_MODULES = [
    "app.pointclouds.startup",
    "app.surfaces.startup",
    "app.volumes.startup",
    "app.surfaces.design.startup",
]


class _Runner:
    def is_live(self, job_id):
        return False


# --- project folders -----------------------------------------------------------------------------


def test_project_handle_names_the_three_new_folders(handle):
    assert handle.pointclouds_dir == handle.folder / "pointclouds"
    assert handle.surfaces_dir == handle.folder / "surfaces"
    assert handle.volumes_dir == handle.folder / "volumes"


# --- startup sweeps ------------------------------------------------------------------------------


@pytest.mark.parametrize("module", SWEEP_MODULES)
def test_each_sweep_is_a_no_op_until_its_unit_lands(handle, module):
    assert importlib.import_module(module).sweep_interrupted(handle, _Runner()) == []


def test_project_opened_runs_all_four_sweeps_even_when_one_fails(handle, monkeypatch, caplog):
    called: list[str] = []

    def recorder(name, fail=False):
        def sweep(h, runner):
            assert h is handle
            called.append(name)
            if fail:
                raise RuntimeError("boom")
            return []

        return sweep

    monkeypatch.setattr("app.pointclouds.startup.sweep_interrupted", recorder("pointclouds", fail=True))
    monkeypatch.setattr("app.surfaces.startup.sweep_interrupted", recorder("surfaces"))
    monkeypatch.setattr("app.volumes.startup.sweep_interrupted", recorder("volumes"))
    monkeypatch.setattr("app.surfaces.design.startup.sweep_interrupted", recorder("design"))
    with caplog.at_level(logging.ERROR, logger="app.main"):
        project_opened(handle, _Runner())
    assert called == ["pointclouds", "surfaces", "volumes", "design"]
    assert "interrupted point cloud import sweep failed" in caplog.text


# --- events --------------------------------------------------------------------------------------


def _request():
    published: list[dict] = []
    events = SimpleNamespace(publish=published.append)
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(events=events))), published


@pytest.mark.parametrize(
    ("publish", "event_type", "key"),
    [
        (publish_pointclouds_changed, "pointclouds.changed", "cloud_ids"),
        (publish_surfaces_changed, "surfaces.changed", "surface_ids"),
        (publish_volumes_changed, "volumes.changed", "measurement_ids"),
    ],
)
def test_change_events_carry_their_ids_and_skip_an_empty_list(publish, event_type, key):
    request, published = _request()
    handle = SimpleNamespace(id="p1")
    publish(request, handle, ["a", "b"])
    publish(request, handle, [])
    assert published == [
        {
            "type": event_type,
            "project_id": "p1",
            "job_id": None,
            "progress": None,
            "message": "",
            "payload": {key: ["a", "b"]},
        }
    ]


# --- selftest placeholders -----------------------------------------------------------------------


# One line per placeholder: the unit that builds a real selftest deletes its own line (S1 Task 15,
# S3 Task 8, S2 Task 13), so parallel branches rebase without touching each other's entries. When
# all three are gone the parametrize is empty and pytest skips the test.
@pytest.mark.parametrize(
    "command",
    [
        "pointcloud-selftest",
        "design-selftest",
        "volumes-selftest",
    ],
)
def test_selftest_placeholders_say_so_and_exit_2(capsys, command):
    assert run(["app.exe", command, "--write-fixture", "x.laz"], freeze_support=lambda: None) == 2
    assert capsys.readouterr().out.strip() == f"{command} not built"


# --- the converter seam --------------------------------------------------------------------------


def test_the_real_converter_is_not_built_yet(tmp_path):
    # No `app` fixture here, so the module still holds the real runner.
    assert converter.run_converter is not fake_run_converter
    with pytest.raises(NotImplementedError, match="unit I1"):
        converter.run_converter(
            tmp_path / "in.las", tmp_path / "out", progress=lambda f, m: None, check_cancelled=lambda: None
        )


def test_the_app_fixture_installs_the_offline_converter(app, tmp_path):
    assert converter.run_converter is fake_run_converter
    source = make_las(tmp_path / "in.laz", 400, compressed=True)
    seen: list[float] = []
    result = converter.run_converter(
        source, tmp_path / "octree", progress=lambda f, m: seen.append(f), check_cancelled=lambda: None
    )
    assert isinstance(result, converter.ConverterResult)
    assert result.encoding == "DEFAULT"  # what write_fake_octree writes; the real converter says BROTLI
    meta, xyz, rgb = read_fake_octree(result.octree_dir)
    assert meta["points"] == len(xyz) == 400
    assert seen[0] == 0.0 and seen[-1] == 1.0
    assert rgb[:, 0].max() == 65535 and rgb[:, 1].max() == 65535  # red west, green east


def test_the_offline_converter_paints_a_colourless_cloud_white(app, tmp_path):
    source = make_las(tmp_path / "grey.las", 50, rgb=False, point_format=1)
    result = converter.run_converter(
        source, tmp_path / "octree", progress=lambda f, m: None, check_cancelled=lambda: None
    )
    _, _, rgb = read_fake_octree(result.octree_dir)
    assert (rgb == 65535).all()
