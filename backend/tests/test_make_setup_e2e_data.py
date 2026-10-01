"""The setup real-backend flow's data script (plan 2026-09-30-setup-u6 Task 8)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from PIL import Image

from app.setup.classify import RealHeaderReader, classify

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "make_setup_e2e_data.py"


def _load():
    spec = importlib.util.spec_from_file_location("make_setup_e2e_data", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_writes_a_dji_visual_thermal_pair_in_one_folder_a_pdf_and_junk(tmp_path, capsys):
    script = _load()
    assert script.main(["make_setup_e2e_data.py", str(tmp_path / "delivery")]) == 0
    out = json.loads(capsys.readouterr().out)

    visual, thermal = Path(out["visual"]), Path(out["thermal"])
    assert visual.parent == thermal.parent == Path(out["photos"])
    assert visual.name.endswith("_V.JPG") and thermal.name.endswith("_T.JPG")
    with Image.open(visual) as v, Image.open(thermal) as t:
        assert v.format == t.format == "JPEG"
        assert b"WideCamera" in v.info["xmp"]
        assert b"InfraredCamera" in t.info["xmp"]
        assert t.size == (640, 512)

    pdf = Path(out["drawing"]).read_bytes()
    assert pdf.startswith(b"%PDF")
    assert pdf.count(b"/Type /Page\n") + pdf.count(b"/Type /Page ") + pdf.count(b"/Type /Page>") >= 1
    assert Path(out["junk"]).name == "Thumbs.db"
    assert Path(out["delivery"]) == tmp_path / "delivery"


def test_the_real_classifier_sorts_the_generated_folder(tmp_path, capsys):
    script = _load()
    assert script.main(["make_setup_e2e_data.py", str(tmp_path / "delivery")]) == 0
    out = json.loads(capsys.readouterr().out)
    reader = RealHeaderReader()

    visual = classify(Path(out["visual"]), reader)
    thermal = classify(Path(out["thermal"]), reader)
    assert (visual.route, visual.match) == ("images", {"thermal": False})
    assert (thermal.route, thermal.match) == ("images", {"thermal": True})
    assert classify(Path(out["drawing"]), reader).route == "drawing"
    junk = classify(Path(out["junk"]), reader)
    assert junk.route is None
