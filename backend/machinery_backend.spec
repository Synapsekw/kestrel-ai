# -*- mode: python -*-
from PyInstaller.utils.hooks import collect_submodules

a = Analysis(
    ["app/__main__.py"],
    pathex=["."],
    hiddenimports=collect_submodules("app") + [
        "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on", "websockets.legacy",
    ],
    datas=[("app/db/migrations", "app/db/migrations")],
    excludes=["torch", "torchvision", "ultralytics", "cv2", "sahi"],  # S0 only; S6 removes this line
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, exclude_binaries=True, name="machinery-backend", console=True)
coll = COLLECT(exe, a.binaries, a.datas, name="machinery-backend")
