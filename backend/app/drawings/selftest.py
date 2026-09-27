"""`kestrel-backend.exe drawings-selftest`: proves the frozen bundle carries PDFium (pypdfium2_raw),
ezdxf's path flattening and the drawing writers. It renders a 2 x 1 inch PDF page at 100 dpi in strips
into a tiled RGBA plan.tif, and flattens a DXF with a circle and a line into indexed runs.
"""

from __future__ import annotations

import tempfile
from pathlib import Path


def run() -> dict:
    import ezdxf
    from reportlab.pdfgen import canvas

    from app.drawings import dxf_flatten, pdf, runs, store

    def quiet(*_a, **_k) -> None:
        return None

    with tempfile.TemporaryDirectory(prefix="kestrel-drawings-") as tmp:
        t = Path(tmp)
        c = canvas.Canvas(str(t / "p.pdf"), pagesize=(144, 72))
        c.line(0, 0, 144, 72)
        c.showPage()
        c.save()
        width, height = pdf.render_page_to_plan(
            t / "p.pdf", 1, 100, t / "plan.tif", progress=quiet, check_cancelled=quiet
        )
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = 6
        doc.modelspace().add_circle((0, 0), 5)
        doc.modelspace().add_line((0, 0), (10, 10))
        doc.saveas(t / "d.dxf")
        idir = t / "insp"
        (idir / "thumbs").mkdir(parents=True)
        result = dxf_flatten.inspect_file(t / "d.dxf", idir, progress=quiet, check_cancelled=quiet)
        runs.build_index(store.lines_dir(idir))
        idx = runs.BucketIndex(store.lines_dir(idir))
        hits = len(idx.query((-6.0, -6.0, 11.0, 11.0)))
        idx.release(collect=True)  # the temporary folder is removed next (Windows)
    return {"plan": f"{width}x{height}", "runs": hits, "layers": len(result.layers)}


def main(argv: list[str] | None = None) -> int:
    """`argv` (the arguments after `drawings-selftest`) is accepted and ignored."""
    facts = run()
    ok = facts["plan"] == "200x100" and facts["runs"] == 2
    print(f"drawings ok {facts['plan']} {facts['runs']}" if ok else f"drawings selftest failed: {facts}")
    return 0 if ok else 1
