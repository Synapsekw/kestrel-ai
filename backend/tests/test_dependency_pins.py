"""The direct dependencies foundation F0 adds for the point-cloud, volumes and design specs.

Pinned in both requirements files and installed at exactly that version. On an interpreter that
lacks them this fails loudly by name, rather than as an ImportError deep inside a later unit.
"""

from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
PINS = {
    "laspy": "2.7.0",
    "lazrs": "0.8.2",
    "scipy": "1.17.1",
    "shapely": "2.1.2",
    "psutil": "7.2.2",
    "reportlab": "5.0.1",
    "openpyxl": "3.1.5",
    "ezdxf": "1.4.4",
    "pypdfium2": "5.13.0",  # map workspace M-B3: PDF drawings (spec 2026-09-26-map-workspace M9)
}


def _lines(name: str) -> set[str]:
    return {line.strip() for line in (BACKEND / name).read_text("utf-8").splitlines()}


@pytest.mark.parametrize("requirements", ["requirements.txt", "requirements-lock.txt"])
def test_each_library_is_pinned_exactly(requirements):
    lines = _lines(requirements)
    missing = [f"{name}=={pin}" for name, pin in PINS.items() if f"{name}=={pin}" not in lines]
    assert not missing, f"{requirements} lacks {missing}"


def test_the_lock_carries_the_new_transitive_dependency():
    assert "et-xmlfile==2.0.0" in _lines("requirements-lock.txt")  # openpyxl's


@pytest.mark.parametrize(("name", "pin"), sorted(PINS.items()))
def test_the_interpreter_has_the_pinned_version(name, pin):
    try:
        installed = version(name)
    except PackageNotFoundError:
        pytest.fail(f"{name} is not installed; install backend/requirements-lock.txt ({name}=={pin})")
    assert installed == pin


def test_the_lock_stays_resolvable_with_google_genai():
    """google-genai 1.75.0 needs websockets<17 and (via google-auth[requests]) requests>=2.30."""
    lines = _lines("requirements-lock.txt")
    assert "google-genai==1.75.0" in lines and "websockets==16.1.1" in lines
    assert "requests==2.34.2" in lines and "certifi==2026.7.22" in lines
