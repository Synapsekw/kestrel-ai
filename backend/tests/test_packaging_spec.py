"""Regression for the gotcha ADR (2026-09-25): a dynamically-loaded `app.*` module must be in the
frozen bundle (spec section 10).

`app/api.py`'s router loader and `app/main.py`'s startup-sweep loader both call
`importlib.import_module(<string>)` on a handful of `app.pointclouds`/`app.surfaces`/`app.volumes`
module names, so PyInstaller's static bytecode scan never sees them - `kestrel_backend.spec` must
cover them another way (`collect_submodules("app")`). That in turn requires "app" to be importable
in the *process that computes `hiddenimports`*, before `Analysis(pathex=["."])` ever runs; nothing
guarantees that (see the ADR), so `collect_submodules("app")` can silently return `[]` with no
build-time warning, and every dynamically-loaded module quietly drops out of the bundle.

This test extracts the module-name strings from the two loaders and reproduces the real failure
mode: it re-executes the spec's own hiddenimports-computing prelude in a subprocess whose
`sys.path` excludes the backend directory (mimicking how `pyinstaller.exe`'s own entry point can
resolve `sys.path[0]`, independent of `Set-Location`/cwd), and asserts every one of those names
still ends up in `hiddenimports`. Without `kestrel_backend.spec`'s `sys.path.insert(0, SPECPATH)`
fix, this fails exactly like the frozen build did.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import textwrap
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def _extract_dynamic_app_modules() -> set[str]:
    api_src = (BACKEND / "app" / "api.py").read_text("utf-8")
    main_src = (BACKEND / "app" / "main.py").read_text("utf-8")
    names = set(re.findall(r'"(app\.[a-zA-Z0-9_.]+)"', api_src))
    names |= set(re.findall(r'sweep\("(app\.[a-zA-Z0-9_.]+)"\)', main_src))
    assert names, "expected at least one dynamically-loaded app.* module name in api.py/main.py"
    return names


def test_dynamically_loaded_app_modules_are_covered_by_the_spec_hiddenimports():
    targets = _extract_dynamic_app_modules()
    spec_src = (BACKEND / "kestrel_backend.spec").read_text("utf-8")
    prelude, sep, _ = spec_src.partition("\ndatas = (")
    assert sep, "kestrel_backend.spec's shape changed: no 'datas = (' to stop the prelude at"
    assert 'collect_submodules("app")' in prelude

    probe = textwrap.dedent(
        f"""
        import json
        import sys

        # Reproduce the real failure mode: strip the backend dir (and cwd markers) from sys.path,
        # the way pyinstaller.exe's own entry point can leave it before Analysis(pathex=["."]) runs.
        _backend = {str(BACKEND)!r}
        sys.path = [p for p in sys.path if p not in ("", ".", _backend)]

        SPECPATH = _backend
        __file__ = {str(BACKEND / "kestrel_backend.spec")!r}

        {textwrap.indent(prelude, "        ").lstrip()}

        print(json.dumps(sorted(hiddenimports)))
        """
    )
    result = subprocess.run(
        [sys.executable, "-c", probe],
        capture_output=True,
        text=True,
        cwd=str(BACKEND.parent),
        timeout=120,
    )
    assert result.returncode == 0, f"probe subprocess failed:\n{result.stdout}\n{result.stderr}"
    hidden = set(json.loads(result.stdout.strip().splitlines()[-1]))
    missing = targets - hidden
    assert not missing, f"kestrel_backend.spec's hiddenimports does not cover: {sorted(missing)}"
