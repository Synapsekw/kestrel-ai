"""The volumes PDF report (spec 2026-09-23-volumes §10): reportlab, A4 portrait, built-in Helvetica
only (no font files to freeze). Page 1 summarises; each measurement gets its own page(s); the last
page states the method, the thresholds and what the ± leaves out."""

from __future__ import annotations

import io
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.volumes import alignment as align_consts
from app.volumes import bases, regions
from app.volumes.engine import ENGINE_VERSION, NODATA_DANGER, NODATA_WARN
from app.volumes.items import ExportItem

STYLES = getSampleStyleSheet()
GRID = TableStyle(
    [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]
)
KV = TableStyle(
    [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8),
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 8),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.lightgrey),
    ]
)


def m3(v: float | None) -> str:
    return "—" if v is None else f"{v:,.1f} m³"


def m2(v: float | None) -> str:
    return "—" if v is None else f"{v:,.1f} m²"


def metres(v: float | None) -> str:
    return "—" if v is None else f"{v:.3f} m"


class _NumberedCanvas(rl_canvas.Canvas):
    """Draws "Kestrel AI · <date> · page n/N" once the page count is known."""

    footer_date = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._pages = []

    def showPage(self):  # noqa: N802 - reportlab's name
        self._pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._pages)
        for state in self._pages:
            self.__dict__.update(state)
            self.setFont("Helvetica", 7)
            self.drawRightString(
                A4[0] - 15 * mm, 10 * mm, f"Kestrel AI · {self.footer_date} · page {self._pageNumber}/{total}"
            )
            super().showPage()
        super().save()


def _kv(rows: list[tuple[str, str]]) -> Table:
    t = Table([[k, v] for k, v in rows], colWidths=[55 * mm, 115 * mm])
    t.setStyle(KV)
    return t


def _summary(items: list[ExportItem]) -> Table:
    head = ["Name", "Base", "Fill", "Cut", "Net", "±", "Area", "Status"]
    rows = [
        [
            i.name,
            i.base_detail,
            m3(i.results["fill_m3"]),
            m3(i.results["cut_m3"]),
            m3(i.results["net_m3"]),
            m3(i.results["uncertainty"]["total_m3"]),
            m2(i.results["area_m2"]),
            i.status,
        ]
        for i in items
    ]
    t = Table([head, *rows], repeatRows=1)
    t.setStyle(GRID)
    return t


def _measurement(item: ExportItem) -> list:
    r, lab = item.results, item.labels
    story: list = [Paragraph(escape(item.name), STYLES["Heading2"])]
    if item.plan_png:
        story += [
            Image(io.BytesIO(item.plan_png), width=170 * mm, height=110 * mm, kind="proportional"),
            Spacer(1, 4 * mm),
        ]
    top, base = r["top_surface"], r.get("base_surface")

    def surface_line(ref: dict) -> str:
        sha = (ref.get("cloud_sha256") or "")[:12]
        return (
            f"{ref['name']} — {ref.get('cloud_file') or 'no cloud'} {sha} · "
            f"{ref.get('captured_on') or 'no date'} · "
            f"{ref.get('method')} · {ref['cell_size_m']} m · EPSG:{item.epsg or 'local'}"
        )

    masks = item.masks
    story += [
        Paragraph("Inputs", STYLES["Heading3"]),
        _kv(
            [
                ("Top surface", surface_line(top)),
                ("Base", item.base_detail + (f" — {surface_line(base)}" if base else "")),
                (
                    "Mask runs",
                    f"{len(masks.get('detection_run_ids', []))} run(s), "
                    f"buffer {masks.get('buffer_m', 1.0)} m",
                ),
                ("Exclusions", str(len(masks.get("exclusion_polygons", [])))),
            ]
        ),
        Paragraph("Results", STYLES["Heading3"]),
        _kv(
            [
                (f"{lab.fill} (fill_m3)", m3(r["fill_m3"])),
                (f"{lab.cut} (cut_m3)", m3(r["cut_m3"])),
                ("Net (net_m3)", m3(r["net_m3"])),
                (
                    "± (indicative)",
                    m3(r["uncertainty"]["total_m3"])
                    + ("" if r["uncertainty"]["complete"] else " — incomplete"),
                ),
            ]
        ),
        Paragraph("Areas", STYLES["Heading3"]),
    ]
    share = r["nodata_area_m2"] / r["area_m2"] if r["area_m2"] else 0.0
    story.append(
        _kv(
            [
                ("Polygon (exact)", m2(r["polygon_area_m2"])),
                ("Polygon (cells)", m2(r["area_m2"])),
                ("Measured", m2(r["measured_area_m2"])),
                ("Patched (masked)", m2(r["masked_area_m2"])),
                ("Excluded", m2(r["excluded_area_m2"])),
                (
                    "No data",
                    f"No data: {m2(r['nodata_area_m2'])} ({share:.1%}) — volume there is unknown, "
                    f"estimated ± {m3(r['uncertainty']['nodata_m3'])}",
                ),
            ]
        )
    )
    a = r.get("alignment")
    if item.base["kind"] == "surface":
        rows = [("Stable area", "none drawn")]
        if a:
            rows = [
                ("Cells", f"{a['n_cells']:,}"),
                ("Median dZ", metres(a["median_dz"])),
                ("MAD / σ", f"{metres(a['mad'])} / {metres(a['sigma'])}"),
                ("Tilt", f"{a['tilt_mm_per_m']:.2f} mm/m over {a['span_m']:.0f} m"),
                ("Shift applied", metres(r["shift_applied_m"])),
            ]
            if r.get("unshifted"):
                u = r["unshifted"]
                rows.append(
                    (
                        "Without the shift",
                        f"fill {m3(u['fill_m3'])}, cut {m3(u['cut_m3'])}, net {m3(u['net_m3'])}",
                    )
                )
        story += [Paragraph("Alignment check", STYLES["Heading3"]), _kv(rows)]
    fit = r.get("base_fit")
    if fit:
        story += [
            Paragraph("Base fit", STYLES["Heading3"]),
            _kv(
                [
                    ("Edge samples", f"{fit['samples']} ({fit['rejected']} rejected)"),
                    ("Usable edge", f"{fit['usable_edge_fraction']:.0%}"),
                    ("RMS", metres(fit["rms_m"])),
                ]
            ),
        ]
    u = r["uncertainty"]
    story += [
        Paragraph("How sure is this? (indicative)", STYLES["Heading3"]),
        _kv(
            [
                ("Base", m3(u["base_m3"])),
                ("Alignment", m3(u["alignment_m3"])),
                ("Cell size", m3(u["cell_size_m3"])),
                ("No data", m3(u["nodata_m3"])),
                ("Patches", m3(u["patch_m3"])),
                ("Total (root-sum-square)", m3(u["total_m3"])),
            ]
        ),
    ]
    if r["warnings"]:
        story.append(Paragraph("Warnings", STYLES["Heading3"]))
        story += [
            Paragraph(f"<b>{w['severity']}</b> {w['code']}: {escape(w['message'])}", STYLES["BodyText"])
            for w in r["warnings"]
        ]
    return story


def _method() -> list:
    text = [
        "Volumes are prisms per cell: dz = top − (base + shift); fill = Σ max(dz, 0) × cell², "
        "cut = Σ max(−dz, 0) × cell², net = fill − cut, summed in 64-bit floating point.",
        "A cell is inside the polygon when its centre is (GDAL's rule). Mask cells use every cell a "
        "footprint touches.",
        "Each surface cell holds one statistic of the points in it (the median by default; the mean, "
        "highest and lowest are offered: highest overstates stockpiles by 2–7 %, lowest understates them). "
        "Gaps up to about 1 m inside the data are filled from 5 or more of 8 valid neighbours; cells "
        "with 2 or fewer points more than 1 m from their neighbours' median are despiked.",
        f"Machines are masked with their detection boxes buffered by the chosen distance and "
        "re-interpolated from a ring of ground around them; masked areas over "
        f"{regions.MAX_PATCH_AREA_M2:.0f} m² "
        "are left as no data. A patch whose ring lacks ground on enough sides fails and is also left "
        "as no data (warning patch_failed).",
        f"Toe bases are fitted to the observed polygon edge; samples more than max(3σ, "
        f"{bases.REJECT_FLOOR_M} m) from the fit are rejected; "
        f"a fit RMS above {bases.FIT_POOR_M} m is flagged.",
        f"Alignment thresholds: offset {align_consts.OFFSET_M} m, datum {align_consts.DATUM_M} m, noise "
        f"σ {align_consts.NOISY_M} m, tilt {align_consts.TILT_MM_PER_M} mm/m and "
        f"{align_consts.TILT_DRIFT_M} m over the stable area, at least {align_consts.MIN_CELLS} cells "
        f"and {align_consts.MIN_AREA_M2:.0f} m². "
        f"No data is flagged above {NODATA_WARN:.0%} and {NODATA_DANGER:.0%} of the area.",
        "The ± is indicative: the root-sum-square of the base, alignment, cell-size, no-data and patch "
        "terms. It does not include the survey's own georeferencing accuracy.",
        "Heights are as stored in the point cloud (no vertical datum conversion). Areas and volumes are "
        "grid quantities in the coordinate system; the grid-to-ground areal scale factor is printed "
        "for each measurement and not applied.",
        "A 2.5D surface cannot represent vertical faces or overhangs; use the 3D viewer for structures.",
        f"Engine version {ENGINE_VERSION}.",
    ]
    return [Paragraph("Method", STYLES["Heading2"]), *(Paragraph(t, STYLES["BodyText"]) for t in text)]


def story(items: list[ExportItem], *, title: str, project_name: str, generated_at: datetime) -> list:
    """The report's flowables, in page order (tests read their text, as the detection report's do)."""
    out: list = [
        Paragraph(escape(title), STYLES["Title"]),
        Paragraph(f"Project: {escape(project_name)}", STYLES["BodyText"]),
        Paragraph(f"Generated: {generated_at.strftime('%Y-%m-%d %H:%M %Z')}", STYLES["BodyText"]),
        Spacer(1, 6 * mm),
        _summary(items),
    ]
    for item in items:
        out += [PageBreak(), *_measurement(item)]
    return [*out, PageBreak(), *_method()]


def write_report(
    path: Path,
    items: list[ExportItem],
    *,
    title: str,
    project_name: str,
    generated_at: datetime,
    compress: bool = True,
) -> None:
    doc = SimpleDocTemplate(
        str(path),
        pagesize=A4,
        title=title,
        author="Kestrel AI",
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=18 * mm,
        pageCompression=1 if compress else 0,
    )

    class Canvas(_NumberedCanvas):
        footer_date = generated_at.strftime("%Y-%m-%d")

    doc.build(
        story(items, title=title, project_name=project_name, generated_at=generated_at), canvasmaker=Canvas
    )
