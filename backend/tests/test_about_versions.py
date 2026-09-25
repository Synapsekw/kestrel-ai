"""The About screen's versions match what is installed and what the build fetches (spec §12)."""

import json
import re
from importlib.metadata import version
from pathlib import Path

from app.pointclouds.converter_path import CONVERTER_VERSION

ROOT = Path(__file__).resolve().parents[2]
NOTICES = {
    c["id"]: c
    for c in json.loads((ROOT / "frontend" / "src" / "about" / "notices.json").read_text("utf-8"))[
        "components"
    ]
}


def test_laspy_and_lazrs_versions_are_the_installed_ones():
    assert NOTICES["laspy"]["version"] == version("laspy")
    assert NOTICES["lazrs"]["version"] == version("lazrs")


def test_potreeconverter_version_is_the_fetched_one():
    script = (ROOT / "backend" / "scripts" / "fetch_potreeconverter.ps1").read_text("utf-8")
    pinned = re.search(r'^\$version = "([^"]+)"', script, re.M).group(1)
    assert NOTICES["potreeconverter"]["version"] == pinned == CONVERTER_VERSION
