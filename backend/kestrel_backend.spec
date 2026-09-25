# -*- mode: python -*-
# One-folder freeze of the backend (spec section 10). The exe doubles as the training/export
# worker (`kestrel-backend.exe worker train <params.json>`), so torch, torchvision, ultralytics
# and the ONNX stack all have to be inside the bundle: nothing is installed on the user's machine.
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

# collect_submodules("app") below needs "app" importable *in this process*, before Analysis(pathex=["."])
# ever runs. Depending on how pyinstaller.exe is invoked, sys.path[0] can be the entry-point script's own
# directory (e.g. .venv/Scripts) rather than the current working directory, so plain `import app` can fail
# here even though `Set-Location $backend` (build.ps1) put the right folder on the *process* cwd. Without
# this, collect_submodules("app") silently returns [] (see the gotcha ADR): every module reachable only
# through a dynamic `importlib.import_module("app...")` string (F0's router/startup dispatch in
# app/api.py and app/main.py) would then be missing from the frozen bundle with no build-time warning.
if SPECPATH not in sys.path:
    sys.path.insert(0, SPECPATH)

hiddenimports = (
    collect_submodules("app")
    + collect_submodules("ultralytics")
    # point clouds (spec 2026-09-23-point-clouds section 5 item 6): laspy picks its LAZ backend
    # at runtime, so lazrs is named; PotreeConverter's own payload is added by unit K1.
    + collect_submodules("laspy")
    + [
        "torch",
        "torchvision",
        # torchvision 0.29 loads its C++ ops through torch.ops.load_library(<path>), not an
        # import, so PyInstaller cannot see them: without these the bundle starts but every
        # prediction dies on "operator torchvision::nms does not exist". (The upstream hook
        # still names the pre-0.29 `torchvision._C` and `torchvision.image`, which are gone.)
        "torchvision._C_stable",
        "torchvision.image_stable",
        "cv2",
        "onnx",
        "onnxslim",
        "onnxruntime",
        "anthropic",
        "openai",
        # keyring resolves its backend by entry point at runtime; the frozen build has no entry
        # points, so the Windows Credential Manager backend and its ctypes bindings are named here.
        # (The brief also lists `pywin32_system32`; it is not a module in this venv - keyring uses
        # pywin32-ctypes, which is pure ctypes - so naming it would only produce a build warning.)
        "keyring.backends.Windows",
        "win32ctypes.pywin32",
        "alembic",
        "sqlalchemy.dialects.sqlite",
        "uvicorn.logging",
        "uvicorn.loops.auto",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan.on",
        "websockets",
        "anyio._backends._asyncio",
        # maps: rasterio's Cython modules import each other at runtime; PyInstaller misses these
        "rasterio.sample",
        "rasterio.vrt",
        "rasterio._features",
        "rasterio.crs",
        "pyproj.database",
        # rasterio._base is a compiled .pyx that imports this pure Python module at init time;
        # PyInstaller's static analysis cannot see into a compiled extension, so without this the
        # frozen build raises `ModuleNotFoundError: No module named 'rasterio.serde'` at startup
        # (found during the freeze spike, ADR 2026-09-22).
        "rasterio.serde",
        "lazrs",
    ]
)

datas = (
    [(str(Path(SPECPATH) / "app" / "db" / "migrations"), "app/db/migrations")]
    # The model library's own Alembic history (library.db), read from disk like the project one.
    + [(str(Path(SPECPATH) / "app" / "library" / "migrations"), "app/library/migrations")]
    + collect_data_files("ultralytics")  # cfg/*.yaml, the default trackers and assets
    + collect_data_files("torch", include_py_files=False)
    # Starter weights (usability gap G1): yolo11n/s/m.pt, fetched by scripts/fetch_starter_weights.ps1.
    # Relative to this spec file (SPECPATH), not the cwd PyInstaller happens to be run from.
    + [(str(p), "starter_weights") for p in sorted((Path(SPECPATH) / "starter_weights").glob("yolo11*.pt"))]
    + collect_data_files("rasterio")  # gdal_data/ and proj_data/ (ADR 2026-09-22)
    + collect_data_files("pyproj")  # proj_dir/share/proj/proj.db
    # The detection PDF report (plan 2 unit E). reportlab's standard-font metric modules are named
    # by pyinstaller-hooks-contrib (hook-reportlab.pdfbase._fontdata); its fonts/ folder is data.
    + collect_data_files("reportlab")
)

# PotreeConverter 2.1.5 + laszip.dll + the MSVC runtime + licence texts (spec §14), fetched by
# scripts/fetch_potreeconverter.ps1. As datas, not binaries: PyInstaller must keep the folder layout
# and must not relocate the DLLs away from the exe that loads them.
POTREE = Path(SPECPATH) / "third_party" / "potreeconverter"
datas += [
    (str(p), (Path("potreeconverter") / p.relative_to(POTREE).parent).as_posix())
    for p in sorted(POTREE.rglob("*"))
    if p.is_file()
]

binaries = (
    collect_dynamic_libs("torch")  # torch/lib: the CUDA runtime, cuDNN and cuBLAS DLLs
    + collect_dynamic_libs("torchvision")
    + collect_dynamic_libs("onnxruntime")
    + collect_dynamic_libs("rasterio")  # rasterio.libs/: GDAL, PROJ, GEOS, libjpeg ...
    + collect_dynamic_libs("pyproj")
)

a = Analysis(
    ["app/__main__.py"],
    pathex=["."],
    hiddenimports=hiddenimports,
    datas=datas,
    binaries=binaries,
)
pyz = PYZ(a.pure)
# console=False: a windowed exe still writes to whatever stdio handles its parent gives it, so
# the startup JSON line survives - scripts/smoke_frozen.ps1 starts the exe with stdout
# redirected to a file and parses the port out of it, which is the same pipe the shell plugin
# hands the sidecar. Windowed also keeps the training worker subprocess (which the frozen exe
# spawns for every run) from flashing a console window.
exe = EXE(pyz, a.scripts, exclude_binaries=True, name="kestrel-backend", console=False)
coll = COLLECT(exe, a.binaries, a.datas, name="kestrel-backend")
