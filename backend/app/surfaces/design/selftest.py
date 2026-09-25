"""`kestrel-backend.exe design-selftest`: proves the frozen bundle carries ezdxf and scipy.spatial.

It writes a DXF with ten 3D faces, reads it back through ezdxf's recover path (the one the reader
uses) and runs a Delaunay of 100 points (Qhull). Task 14 adds a 64 x 64 SurfaceWriter write.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np


def run() -> dict:
    import ezdxf
    from ezdxf import recover
    from scipy.spatial import Delaunay

    with tempfile.TemporaryDirectory(prefix="kestrel-design-") as tmp:
        path = Path(tmp) / "selftest.dxf"
        doc = ezdxf.new("R2010")
        msp = doc.modelspace()
        for i in range(10):
            msp.add_3dface([(i, 0, 0), (i + 1, 0, 1), (i, 1, 2)], dxfattribs={"layer": "TIN"})
        doc.saveas(path)
        back, _auditor = recover.readfile(str(path))
        faces = sum(1 for e in back.modelspace() if e.dxftype() == "3DFACE")
    tri = Delaunay(np.random.default_rng(0).random((100, 2)))
    return {"faces": faces, "triangles": int(len(tri.simplices))}


def main(argv: list[str] | None = None) -> int:
    """`argv` (the arguments after `design-selftest`) is accepted and ignored, as F0 dispatches it."""
    facts = run()
    ok = facts["faces"] == 10 and facts["triangles"] > 0
    print(f"design ok {facts['faces']} {facts['triangles']}" if ok else f"design selftest failed: {facts}")
    return 0 if ok else 1
