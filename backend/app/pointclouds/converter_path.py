"""Where PotreeConverter.exe lives (spec §14).

Frozen: only `_MEIPASS/potreeconverter/PotreeConverter.exe`, the copy the build verified. Dev:
`KESTREL_POTREECONVERTER`, else `backend/third_party/potreeconverter/`, which
`backend/scripts/fetch_potreeconverter.ps1` fills.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from app.jobs.cancellation import JobFailure

CONVERTER_VERSION = "2.1.5"
NOT_INSTALLED = "the point-cloud converter is not installed (run backend\\scripts\\fetch_potreeconverter.ps1)"
_BACKEND = Path(__file__).resolve().parents[2]


def default_dev_exe() -> Path:
    return _BACKEND / "third_party" / "potreeconverter" / "PotreeConverter.exe"


def converter_exe() -> Path | None:
    if getattr(sys, "frozen", False):
        exe = Path(sys._MEIPASS) / "potreeconverter" / "PotreeConverter.exe"
    else:
        env = os.environ.get("KESTREL_POTREECONVERTER")
        exe = Path(env) if env else default_dev_exe()
    return exe if exe.is_file() else None


def require_converter() -> Path:
    exe = converter_exe()
    if exe is None:
        raise JobFailure(NOT_INSTALLED)
    return exe
