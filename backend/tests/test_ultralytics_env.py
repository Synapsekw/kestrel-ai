"""The packaged app has to train offline, so Ultralytics' Arial.ttf is seeded, never downloaded."""

import os
from pathlib import Path

from app.training import fonts, worker


def test_ensure_font_copies_the_first_candidate_that_exists(tmp_path: Path, monkeypatch):
    source = tmp_path / "somewhere" / "arial.ttf"
    source.parent.mkdir()
    source.write_bytes(b"ttf-bytes")
    monkeypatch.setattr(fonts, "font_candidates", lambda: [tmp_path / "missing.ttf", source])

    seeded = fonts.ensure_font(tmp_path / "cfg")

    assert seeded == tmp_path / "cfg" / "Arial.ttf"
    assert seeded.read_bytes() == b"ttf-bytes"


def test_ensure_font_keeps_a_font_that_is_already_there(tmp_path: Path, monkeypatch):
    config_dir = tmp_path / "cfg"
    config_dir.mkdir()
    (config_dir / "Arial.ttf").write_bytes(b"mine")
    monkeypatch.setattr(fonts, "font_candidates", lambda: [])

    assert fonts.ensure_font(config_dir).read_bytes() == b"mine"


def test_ensure_font_gives_up_quietly_when_no_font_is_installed(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(fonts, "font_candidates", lambda: [tmp_path / "nope.ttf"])
    assert fonts.ensure_font(tmp_path / "cfg") is None


def test_this_machine_has_a_font_candidate():
    """The real candidate list has to resolve on the reference machine, frozen or not."""
    assert any(c.is_file() for c in fonts.font_candidates()), fonts.font_candidates()


def test_configure_ultralytics_points_the_config_dir_at_app_data(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("YOLO_CONFIG_DIR", "")  # empty reads as unset and is restored

    config_dir = fonts.configure_ultralytics(tmp_path / "appdata")

    assert config_dir == tmp_path / "appdata" / "ultralytics"
    assert os.environ["YOLO_CONFIG_DIR"] == str(config_dir)
    assert (config_dir / "Arial.ttf").is_file()


def test_configure_ultralytics_honours_a_config_dir_the_launcher_already_chose(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("YOLO_CONFIG_DIR", str(tmp_path / "chosen"))
    assert fonts.configure_ultralytics(tmp_path / "appdata") == tmp_path / "chosen"


def test_configure_ultralytics_falls_back_to_app_data_dir_from_the_environment(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("YOLO_CONFIG_DIR", "")  # empty reads as unset and is restored
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path / "inherited"))
    assert fonts.configure_ultralytics() == tmp_path / "inherited" / "ultralytics"


def test_configure_ultralytics_is_a_no_op_without_anywhere_to_put_it(monkeypatch):
    monkeypatch.setenv("YOLO_CONFIG_DIR", "")  # empty reads as unset and is restored
    monkeypatch.delenv("APP_DATA_DIR", raising=False)
    assert fonts.configure_ultralytics() is None


def test_the_worker_seeds_the_font_before_it_does_anything_else(tmp_path: Path, monkeypatch):
    """The worker's setup step runs even when the run itself cannot start."""
    monkeypatch.setenv("YOLO_CONFIG_DIR", "")  # empty reads as unset and is restored
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path / "appdata"))
    run_dir = tmp_path / "run"
    run_dir.mkdir()

    assert worker.main(["train", str(run_dir / "params.json")]) == 1  # no params file: setup still ran

    assert (tmp_path / "appdata" / "ultralytics" / "Arial.ttf").is_file()
