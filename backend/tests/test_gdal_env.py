"""GDAL/PROJ data folders in the frozen build (ADR 2026-09-22 rasterio in the frozen sidecar)."""

from pathlib import Path

from app.maps.gdal_env import configure_gdal_env


def _bundle(tmp_path: Path) -> Path:
    (tmp_path / "rasterio" / "gdal_data").mkdir(parents=True)
    (tmp_path / "rasterio" / "proj_data").mkdir(parents=True)
    return tmp_path


def test_sets_both_folders_from_the_bundle(tmp_path):
    base = _bundle(tmp_path)
    env: dict[str, str] = {}
    applied = configure_gdal_env(base, env)
    assert env["GDAL_DATA"] == str(base / "rasterio" / "gdal_data")
    assert env["PROJ_DATA"] == str(base / "rasterio" / "proj_data")
    assert env["PROJ_LIB"] == env["PROJ_DATA"]  # PROJ < 9.1 reads PROJ_LIB
    assert applied == env


def test_never_overrides_an_operator_value(tmp_path):
    base = _bundle(tmp_path)
    env = {"GDAL_DATA": "C:/mine"}
    configure_gdal_env(base, env)
    assert env["GDAL_DATA"] == "C:/mine"


def test_missing_folders_are_skipped(tmp_path):
    env: dict[str, str] = {}
    assert configure_gdal_env(tmp_path, env) == {}
    assert env == {}


def test_not_frozen_is_a_no_op(monkeypatch):
    monkeypatch.delattr("sys.frozen", raising=False)
    env: dict[str, str] = {}
    assert configure_gdal_env(None, env) == {}
