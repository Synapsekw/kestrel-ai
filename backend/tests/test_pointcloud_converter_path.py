"""Where PotreeConverter.exe is found (spec §14), and the build's payload check."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.jobs.cancellation import JobFailure
from app.pointclouds import converter_path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def test_frozen_uses_only_the_bundle(monkeypatch, tmp_path):
    exe = tmp_path / "potreeconverter" / "PotreeConverter.exe"
    exe.parent.mkdir()
    exe.write_bytes(b"MZ")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    monkeypatch.setenv("KESTREL_POTREECONVERTER", str(tmp_path / "elsewhere.exe"))
    assert converter_path.converter_exe() == exe


def test_dev_prefers_the_environment(monkeypatch, tmp_path):
    exe = tmp_path / "pc" / "PotreeConverter.exe"
    exe.parent.mkdir()
    exe.write_bytes(b"MZ")
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.setenv("KESTREL_POTREECONVERTER", str(exe))
    assert converter_path.converter_exe() == exe


def test_dev_default_is_third_party(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.delenv("KESTREL_POTREECONVERTER", raising=False)
    expected = Path(__file__).resolve().parents[1] / "third_party" / "potreeconverter" / "PotreeConverter.exe"
    assert converter_path.default_dev_exe() == expected


def test_missing_converter_fails_readably(monkeypatch, tmp_path):
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.setenv("KESTREL_POTREECONVERTER", str(tmp_path / "missing.exe"))
    assert converter_path.converter_exe() is None
    with pytest.raises(JobFailure) as e:
        converter_path.require_converter()
    assert str(e.value) == (
        "the point-cloud converter is not installed (run backend\\scripts\\fetch_potreeconverter.ps1)"
    )


def _payload(dir_: Path, names: list[str], present: list[str]) -> None:
    dir_.mkdir(parents=True, exist_ok=True)
    for n in present:
        (dir_ / n).parent.mkdir(parents=True, exist_ok=True)
        (dir_ / n).write_bytes(b"x")
    manifest = {"converter_version": "2.1.5", "files": [{"name": n, "size": 1, "sha256": "0"} for n in names]}
    (dir_ / "MANIFEST.json").write_text(json.dumps(manifest), "utf-8")


def _check(dir_: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(SCRIPTS / "check_potree_payload.ps1"),
            "-Dir",
            str(dir_),
        ],
        capture_output=True,
        text=True,
    )


@pytest.mark.skipif(os.name != "nt", reason="PowerShell build scripts are Windows-only")
def test_payload_check_passes_on_a_complete_payload(tmp_path):
    names = ["PotreeConverter.exe", "laszip.dll", "licenses/license_laszip.txt"]
    _payload(tmp_path / "p", names, names)
    r = _check(tmp_path / "p")
    assert r.returncode == 0, r.stdout + r.stderr


@pytest.mark.skipif(os.name != "nt", reason="PowerShell build scripts are Windows-only")
def test_payload_check_fails_when_a_manifest_file_is_missing(tmp_path):
    names = ["PotreeConverter.exe", "laszip.dll", "vcruntime140_1.dll"]
    _payload(tmp_path / "p", names, names[:2])
    r = _check(tmp_path / "p")
    assert r.returncode != 0
    assert "vcruntime140_1.dll" in r.stdout + r.stderr


@pytest.mark.skipif(os.name != "nt", reason="PowerShell build scripts are Windows-only")
def test_payload_check_fails_without_a_manifest(tmp_path):
    (tmp_path / "p").mkdir()
    r = _check(tmp_path / "p")
    assert r.returncode != 0 and "fetch_potreeconverter.ps1" in r.stdout + r.stderr
