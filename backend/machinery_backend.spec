# -*- mode: python -*-
# One-folder freeze of the backend (spec section 10). The exe doubles as the training/export
# worker (`machinery-backend.exe worker train <params.json>`), so torch, torchvision, ultralytics
# and the ONNX stack all have to be inside the bundle: nothing is installed on the user's machine.
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

hiddenimports = (
    collect_submodules("app")
    + collect_submodules("ultralytics")
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
    ]
)

datas = (
    [(str(Path(SPECPATH) / "app" / "db" / "migrations"), "app/db/migrations")]
    + collect_data_files("ultralytics")  # cfg/*.yaml, the default trackers and assets
    + collect_data_files("torch", include_py_files=False)
    # Starter weights (usability gap G1): yolo11n/s/m.pt, fetched by scripts/fetch_starter_weights.ps1.
    # Relative to this spec file (SPECPATH), not the cwd PyInstaller happens to be run from.
    + [(str(p), "starter_weights") for p in sorted((Path(SPECPATH) / "starter_weights").glob("yolo11*.pt"))]
)

binaries = (
    collect_dynamic_libs("torch")  # torch/lib: the CUDA runtime, cuDNN and cuBLAS DLLs
    + collect_dynamic_libs("torchvision")
    + collect_dynamic_libs("onnxruntime")
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
exe = EXE(pyz, a.scripts, exclude_binaries=True, name="machinery-backend", console=False)
coll = COLLECT(exe, a.binaries, a.datas, name="machinery-backend")
