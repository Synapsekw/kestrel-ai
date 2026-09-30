"""ReportDocument fixtures for the PDF renderer tests (field names: app/reports/schemas.py, R0).

Snapshot keys must be 32 hex characters (R0 `SnapshotKey`), so the helpers take a readable name and
hash it with `key(name)`; tests compare against `key("...")` (controller ruling P2)."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path

from report_pdf_helpers import jpeg

GENERATED = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)


def key(name: str) -> str:
    """The snapshot key for a readable name: md5 hex, matching R0's ^[0-9a-f]{32}$."""
    return hashlib.md5(name.encode()).hexdigest()


def ref(name: str, missing_reason: str | None = None) -> dict:
    out = {
        "key": key(name),
        "spec": {"kind": "volume_plan", "measurement_id": name},
        "width_px": 1200,
        "height_px": 900,
    }
    if missing_reason:
        out["missing_reason"] = missing_reason
    return out


def figure(name: str, caption: str = "", w: float = 170, h: float = 105) -> dict:
    return {"kind": "figure", "snapshot": ref(name), "caption": caption, "width_mm": w, "height_mm": h}


def finding(
    n: int,
    *,
    type_name: str = "Crack",
    figs=("main", "a", "b"),
    comments: int = 1,
    note="Hairline crack.",
    photos: int = 2,
    severity: bool = True,
) -> dict:
    head = {"type_name": type_name, "type_colour": "#E4572E", "status": "open"}
    if severity:
        head |= {"severity_level": 3, "severity_name": "Major", "severity_colour": "#F59E0B"}
    return {
        "kind": "finding",
        "finding_id": f"fid-{n}",
        "number": n,
        "head": head,
        "figures": [
            figure(f"f{n}-{k}", w=170 if i == 0 else 83, h=105 if i == 0 else 52) for i, k in enumerate(figs)
        ],
        "kv": [
            ["Data item", "DJI_0001.JPG"],
            ["Observed", "2026-09-20"],
            ["Coordinates", "29.3759, 47.9774"],
        ],
        "note": note,
        "photos": [figure(f"p{n}-{i}", w=40, h=30) for i in range(photos)],
        "comments": [
            {
                "author": "Dana",
                "text": f"Comment {i} on F-{n:04d}",
                "created_at": f"2026-09-2{i % 10}T10:00:00Z",
            }
            for i in range(comments)
        ],
    }


def section(key: str, title: str, blocks: list[dict]) -> dict:
    return {"key": key, "title": title, "blocks": blocks}


def document(sections: list[dict], version: int | None = 3, paper: str | None = None):
    from app.reports.schemas import ReportDocument
    from app.reports.theme import THEME_VERSION

    body = {
        "report_id": "r1",
        "generated_at": GENERATED.isoformat(),
        "theme_version": str(THEME_VERSION),
        "sections": sections,
    }
    if version is not None:
        body["version"] = version
    if paper is not None:
        body["paper"] = {"size": paper}
    return ReportDocument.model_validate(body)


def cover_section(logo_path: str | None = None, locator: bool = True) -> dict:
    """R2's cover block (R2 plan ruling 2): title, subtitle, rows, logo {path project-relative}, locator."""
    cover = {
        "kind": "cover",
        "title": "Quarterly inspection",
        "subtitle": "North yard",
        "rows": [["Project", "Kuwait yard"], ["Author", "D. Jovanovic"], ["Status", "Draft"]],
    }
    if logo_path:
        cover["logo"] = {"asset_id": "a1", "path": logo_path, "width_px": 200, "height_px": 100}
    if locator:
        cover["locator"] = figure("locator", "Site locator", 170, 80)
    return section("cover", "Cover", [cover])


def summary_section() -> dict:
    return section(
        "summary",
        "Summary",
        [
            {"kind": "heading", "level": 1, "text": "Summary"},
            {
                "kind": "kpis",
                "items": [
                    {"label": "Total", "value": "12", "delta": "+2 since v2", "tone": "bad"},
                    {"label": "Open", "value": "7", "tone": "neutral"},
                ],
            },
            {
                "kind": "chart",
                "chart": "bar",
                "series": [{"name": "Findings", "values": [3, 5, 2]}],
                "x_labels": ["Crack", "Spalling", "Rust"],
                "unit": "findings",
            },
        ],
    )


def table_section(rows: int = 2) -> dict:
    return section(
        "findings_table",
        "Findings",
        [
            {"kind": "heading", "level": 1, "text": "Findings"},
            {
                "kind": "table",
                "repeat_header": True,
                "columns": [
                    {"key": "number", "label": "No.", "align": "right", "width_mm": 20, "style": "mono"},
                    {"key": "type", "label": "Type", "align": "left"},
                    {"key": "severity", "label": "Severity", "align": "left", "width_mm": 30},
                ],
                "rows": [
                    [f"F-{i:04d}", "Crack", {"text": "Major", "dot": "#F59E0B"}] for i in range(1, rows + 1)
                ],
            },
        ],
    )


def standard_doc(n_findings: int = 2, logo_path: str | None = None):
    pages = [finding(i, type_name="Crack" if i % 2 else "Spalling") for i in range(1, n_findings + 1)]
    return document(
        [
            cover_section(logo_path),
            summary_section(),
            table_section(),
            section("finding_pages", "Finding pages", pages),
        ]
    )


class Snapshots:
    """A snapshot_path stand-in: one deterministic JPEG per key under `root`. `missing` holds keys."""

    def __init__(
        self, root: Path, size: tuple[int, int] = (1200, 900), missing: frozenset[str] = frozenset()
    ):
        self.root, self.size, self.missing, self.calls = root, size, missing, []

    def __call__(self, ref) -> Path:
        self.calls.append(ref.key)
        if ref.key in self.missing:
            raise FileNotFoundError(ref.key)
        path = self.root / f"{ref.key}.jpg"
        if not path.exists():
            d = hashlib.sha256(ref.key.encode()).digest()
            jpeg(path, *self.size, (d[0], d[1], d[2]))
        return path


def context(snapshots, volume_flowables=None):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm

    from app.reports.pdf import fonts, styles
    from app.reports.pdf.flowables import RenderContext

    st = styles.build_styles(fonts.register_fonts())
    return RenderContext(st, snapshots, volume_flowables, A4[0] - 36 * mm, A4[1] - 36 * mm)
