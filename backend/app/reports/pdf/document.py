"""The report PDF (spec 2026-09-26-reports §10): a ReportDocument -> one or more PDF parts.

Every section starts on a new page and gets a level-0 bookmark; every finding a level-1 bookmark. The
cover section, when it is the first section, is laid out on the cover page template (gradient band,
title and subtitle on the band, the rest below). Progress is reported per flowable from afterFlowable
and cancel is checked there and between parts. Output is deterministic: invariant mode, generated_at as
the creation date, deterministic font subsets, JPEG passthrough. Parts: see plan_parts."""

from __future__ import annotations

import hashlib
import logging
import os
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from reportlab.lib.pagesizes import A4, LETTER
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    FrameBreak,
    KeepInFrame,
    KeepTogether,
    NextPageTemplate,
    PageBreakIfNotEmpty,
    PageTemplate,
    Paragraph,
)

from app.jobs.cancellation import JobCancelled
from app.reports.pdf import active
from app.reports.pdf.canvas import (
    COVER_LOGO_MM,
    Furniture,
    PageMeta,
    band_height,
    canvas_class,
    draw_cover_band,
)
from app.reports.pdf.flowables import (
    FindingEnd,
    RenderContext,
    SectionMark,
    block_flowables,
    kv_table,
    snapshot_refs,
)
from app.reports.pdf.flowables_text import text
from app.reports.pdf.fonts import brand_fonts, register_fonts
from app.reports.pdf.logos import flat_logo
from app.reports.pdf.styles import Styles, build_styles
from app.reports.theme import THEME

if TYPE_CHECKING:
    from app.reports.brand import ResolvedBrand
    from app.reports.schemas import ReportDocument, SnapshotRef, VolumeBlock

log = logging.getLogger(__name__)
PART_BUDGET = 160 * 1024 * 1024
PAGE_SIZES = {"A4": A4, "Letter": LETTER}
SPLIT_KINDS = ("finding", "volume")
PROGRESS_CAP = 0.99  # a build's in-flight fraction; exactly 1.0 is reported only once the files exist


@dataclass(frozen=True)
class PdfPart:
    name: str
    path: Path
    pages: int
    bytes: int
    sha256: str


@dataclass(frozen=True)
class DocMeta:
    title: str
    project: str
    version_label: str
    generated_at: datetime
    paper: str
    author: str = "Kestrel AI"


@dataclass(frozen=True)
class Slice:
    section_index: int
    start: int
    stop: int


def _cover(doc: Any) -> Any | None:
    return doc.sections[0] if doc.sections and doc.sections[0].key == "cover" else None


def _cover_block(section: Any) -> Any | None:
    return next((b for b in section.blocks if b.kind == "cover"), None)


def cover_logo(section: Any, out_dir: Path) -> Path | None:
    """The cover's logo file: the `cover` block's `logo.path` (R2 plan ruling 2) - absolute as is, or
    project-relative, resolved against the first ancestor of `out_dir` that holds it (out_dir lies inside
    the project, spec §6.3) - else a `logo_path` on the section. The one place R4 reads the logo. A
    missing file, or a relative path with a `..` segment, gives None (no logo)."""
    block = _cover_block(section)
    logo = getattr(block, "logo", None) if block is not None else None
    raw = getattr(logo, "path", None) if logo is not None else getattr(section, "logo_path", None)
    if not raw:
        return None
    path = Path(str(raw))
    if not path.is_absolute() and ".." in path.parts:  # project-relative means inside the project
        log.warning("cover logo %s climbs out of the project; skipped", raw)
        return None
    if path.is_absolute():
        return path if path.is_file() else None
    out_dir = Path(out_dir)
    for base in (out_dir, *out_dir.parents):
        if (base / path).is_file():
            return base / path
    return None


def doc_meta(doc: Any) -> DocMeta:
    """Header/footer metadata (plan ruling 5); the single seam onto R0's ReportDocument."""
    cover = _cover(doc)
    title, project = "", ""
    if cover is not None:
        block = _cover_block(cover)
        title = block.title if block is not None else ""
        title = title or next((b.text for b in cover.blocks if b.kind == "heading" and b.level == 1), "")
        rows = list(block.rows) if block is not None else []
        rows += [r for b in cover.blocks if b.kind == "kv" for r in b.rows]
        labels = {str(r[0]).strip().lower(): str(r[1]) for r in rows if len(r) > 1}
        project = labels.get("project") or labels.get("site") or ""
    if not title:
        title = doc.sections[0].title if doc.sections else "Report"
    version = getattr(doc, "version", None)
    paper = getattr(getattr(doc, "paper", None), "size", None)
    return DocMeta(
        title,
        project,
        f"v{version}" if version else "Draft",
        doc.generated_at,
        paper if paper in PAGE_SIZES else "A4",
    )


def plan_parts(doc: Any, size_of: Callable[[Any], int], budget: int) -> list[list[Slice]]:
    """Greedy split (spec §10.4): a new part starts before a break point (a non-cover section's start,
    or a finding/volume block) once the embedded bytes would pass `budget`. Never an empty part; a block
    bigger than the budget stands alone."""
    parts: list[list[Slice]] = [[]]
    used = 0
    for si, section in enumerate(doc.sections):
        start = 0
        for bi, block in enumerate(section.blocks):
            size = size_of(block)
            breakable = section.key != "cover" and (bi == 0 or block.kind in SPLIT_KINDS)
            has_content = bool(parts[-1]) or bi > start
            if breakable and has_content and used + size > budget:
                if bi > start:
                    parts[-1].append(Slice(si, start, bi))
                parts.append([])
                used, start = 0, bi
            used += size
        if not section.blocks and section.key != "cover" and parts[-1] and used > budget:
            parts.append([])
            used = 0
        parts[-1].append(Slice(si, start, len(section.blocks)))
    return parts


def _estimate(block: Any, snapshot_path: Callable, sizes: dict[str, int]) -> int:
    total = 0
    for ref in snapshot_refs(block):
        if ref.key not in sizes:
            try:
                sizes[ref.key] = Path(snapshot_path(ref)).stat().st_size
            except JobCancelled:
                raise
            except Exception:  # unresolvable: embeds a vector placeholder, 0 bytes
                sizes[ref.key] = 0
        total += sizes[ref.key]
    return total


def count_flowables(story: Iterable[Any]) -> int:
    """How many afterFlowable calls a story makes at least: a KeepTogether always splits into its
    contents (reportlab forces the split), so it counts its contents, recursively, not itself. Tables and
    paragraphs that split across pages add calls this cannot predict; _Doc caps the fraction."""
    n = 0
    for f in story:
        n += count_flowables(f._content) if isinstance(f, KeepTogether) else 1
    return n


class _Progress:
    """Monotonic fraction of the PDF phase over `builds` builds, reported only when it rises."""

    def __init__(self, report: Callable[[float], None], builds: int):
        self.report, self.builds, self.best = report, builds, -1.0

    def window(self, index: int) -> Callable[[float], None]:
        def local(f: float) -> None:
            value = min(1.0, (index + min(max(f, 0.0), 1.0)) / self.builds)
            if value > self.best:
                self.best = value
                self.report(value)

        return local


class _Doc(BaseDocTemplate):
    def prepare(
        self,
        page_meta: PageMeta,
        total: int,
        progress: Callable[[float], None],
        check: Callable[[], None],
    ) -> None:
        self.page_meta, self.total_flowables = page_meta, max(total, 1)
        self.on_progress, self.check = progress, check
        self.done, self.active = 0, None

    def beforePage(self):  # noqa: N802 - reportlab's name
        if self.active is not None and self.page > self.active[1]:
            self.page_meta.header_overrides[self.page] = f"{self.active[0]} (cont.)"

    def afterFlowable(self, flowable):  # noqa: N802 - reportlab's name
        mark = getattr(flowable, "_kestrel_bookmark", None)
        if mark is not None:
            key, title, level = mark
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title, key, level=level)
        label = getattr(flowable, "_kestrel_finding", None)
        if label is not None:
            self.active = (label, self.page)
        if isinstance(flowable, FindingEnd):
            self.active = None
        self.done += 1
        self.on_progress(min(self.done / self.total_flowables, PROGRESS_CAP))
        self.check()


def _cover_frames(w: float, h: float, brand_logo: bool = False) -> tuple[Frame, Frame]:
    m = THEME["page"]["margin_mm"] * mm
    chip_h = THEME["cover"]["logo_chip_mm"][1] * mm
    y0 = h - band_height(h)
    pad = dict(leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    bottom = y0 + (m + COVER_LOGO_MM[1] * mm + 4 * mm if brand_logo else 6 * mm)
    band = Frame(m, bottom, w - 2 * m, h - bottom - m - chip_h - 4 * mm, id="band", **pad)
    below = Frame(m, m, w - 2 * m, y0 - 8 * mm - m, id="below", **pad)
    return band, below


def _cover_story(section: Any, ctx: RenderContext, band: Frame) -> list:
    st = ctx.styles
    blocks = list(section.blocks)
    story: list = [SectionMark("s-0", section.title)]
    on_band: list = []
    below: list = []
    cover = _cover_block(section)
    if cover is not None:  # R2's cover block: title/subtitle on the band, rows and locator below
        on_band.append(Paragraph(text(cover.title), st.cover_title))
        if cover.subtitle:
            on_band.append(Paragraph(text(cover.subtitle), st.cover_subtitle))
        below += kv_table(cover.rows, ctx)
        if cover.locator is not None:
            below += block_flowables(cover.locator, ctx)
        rest = [b for b in blocks if b is not cover]
    else:  # no cover block: the first level-1 heading and the paras after it take the band
        at = next((i for i, b in enumerate(blocks) if b.kind == "heading" and b.level == 1), None)
        rest = blocks
        if at is not None:
            on_band.append(Paragraph(text(blocks[at].text), st.cover_title))
            i = at + 1
            while i < len(blocks) and blocks[i].kind == "para":
                on_band.append(Paragraph(text(blocks[i].text), st.cover_subtitle))
                i += 1
            rest = blocks[:at] + blocks[i:]
    if on_band:
        story.append(KeepInFrame(band._width, band._height, on_band, mode="shrink"))
    # The body template is chosen here, not at the end: it takes effect at the next page break, so
    # cover content that overflows the below-band frame continues on a white body page.
    story += [FrameBreak(), NextPageTemplate("body")]
    story += below
    for b in rest:
        story += block_flowables(b, ctx)
    return story


def _no_content(ctx: RenderContext) -> Paragraph:
    return Paragraph("No content", ctx.styles.small)


def _story(doc: Any, part: list[Slice], ctx: RenderContext, band: Frame | None) -> list:
    story: list = []
    for n, sl in enumerate(part):
        section = doc.sections[sl.section_index]
        if band is not None and n == 0 and sl.section_index == 0 and sl.start == 0:
            story += _cover_story(section, ctx, band)
            continue
        if story:
            story.append(PageBreakIfNotEmpty())
        title = section.title if sl.start == 0 else f"{section.title} (cont.)"
        story.append(SectionMark(f"s-{sl.section_index}-{sl.start}", title))
        if not section.blocks:  # an empty section says so rather than printing a blank page
            story.append(_no_content(ctx))
        for block in list(section.blocks)[sl.start : sl.stop]:
            story += block_flowables(block, ctx)
    while story and isinstance(story[-1], PageBreakIfNotEmpty):
        story.pop()
    if not story:  # no sections at all (every one disabled): one honest page, never a 0-page file
        story.append(_no_content(ctx))
    return story


def _build(
    doc: Any,
    part: list[Slice],
    target: str,
    *,
    meta: DocMeta,
    styles: Styles,
    out_dir: Path,
    snapshot_path: Callable,
    volume_flowables: Callable | None,
    offset: int,
    total: int | None,
    progress: Callable[[float], None],
    check_cancelled: Callable[[], None],
    furniture: Furniture,
) -> PageMeta:
    w, h = PAGE_SIZES.get(meta.paper, A4)
    m = THEME["page"]["margin_mm"] * mm
    pad = dict(leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    body = Frame(m, m, w - 2 * m, h - 2 * m, id="body", **pad)
    ctx = RenderContext(styles, snapshot_path, volume_flowables, w - 2 * m, h - 2 * m)
    page_meta = PageMeta(meta.title, meta.version_label, meta.project, meta.generated_at, offset, total)
    page_meta.furniture = furniture
    cover = _cover(doc)
    has_cover = bool(cover is not None and part and part[0].section_index == 0 and part[0].start == 0)
    templates = [PageTemplate(id="body", frames=[body])]
    band = None
    if has_cover:
        band, below = _cover_frames(w, h, furniture.cover_logo is not None)
        logo = cover_logo(cover, out_dir)
        templates.insert(
            0,
            PageTemplate(
                id="cover",
                frames=[band, below],
                onPage=lambda canv, _doc: draw_cover_band(canv, logo, furniture.cover_logo),
            ),
        )
        page_meta.cover_pages = frozenset({1})
    story = _story(doc, part, ctx, band)
    tmpl = _Doc(
        target,
        pagesize=(w, h),
        invariant=1,
        pageCompression=1,
        title=meta.title,
        author=meta.author,
        creator="Kestrel AI",
        subject=meta.project,
        initialFontName=styles.fonts.sans,
        leftMargin=m,
        rightMargin=m,
        topMargin=m,
        bottomMargin=m,
    )
    tmpl.addPageTemplates(templates)
    tmpl.prepare(page_meta, count_flowables(story), progress, check_cancelled)
    tmpl.build(story, canvasmaker=canvas_class(page_meta, styles))
    return page_meta


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


_BUILD_LOCK = threading.Lock()  # reportlab's font registry and default cell font are process-wide


def render_pdf(
    doc: ReportDocument,
    out_dir: Path,
    base_name: str,
    *,
    snapshot_path: Callable[[SnapshotRef], Path],
    volume_flowables: Callable[[VolumeBlock], list] | None,
    progress: Callable[[float], None],
    check_cancelled: Callable[[], None],
    part_budget: int = PART_BUDGET,
    brand: ResolvedBrand | None = None,
) -> list[PdfPart]:
    with _BUILD_LOCK:
        fonts = register_fonts()
        theme = THEME
        if brand is not None:
            fonts = brand_fonts(brand.text_family, brand.numerals_family, fonts)
            theme = brand.theme
        with active.using(theme, fonts.sans):
            furniture = Furniture()
            if brand is not None:
                furniture = Furniture(
                    footer_left=brand.footer_left,
                    footer_right=brand.footer_right,
                    header_logo=flat_logo(brand.header_logo),
                    cover_logo=flat_logo(brand.cover_logo, theme["cover"]["gradient"][0]),
                )
            return _render_parts(
                doc,
                out_dir,
                base_name,
                styles=build_styles(fonts),
                furniture=furniture,
                author=brand.author if brand is not None else "Kestrel AI",
                snapshot_path=snapshot_path,
                volume_flowables=volume_flowables,
                progress=progress,
                check_cancelled=check_cancelled,
                part_budget=part_budget,
            )


def _render_parts(
    doc,
    out_dir,
    base_name,
    *,
    styles,
    furniture,
    author,
    snapshot_path,
    volume_flowables,
    progress,
    check_cancelled,
    part_budget,
) -> list[PdfPart]:
    meta = replace(doc_meta(doc), author=author)
    sizes: dict[str, int] = {}
    parts = plan_parts(doc, lambda b: _estimate(b, snapshot_path, sizes), part_budget)
    n = len(parts)
    names = [f"{base_name}.pdf"] if n == 1 else [f"{base_name}-part{k}-of-{n}.pdf" for k in range(1, n + 1)]
    out_dir.mkdir(parents=True, exist_ok=True)
    tracker = _Progress(progress, n if n == 1 else 2 * n)
    common = dict(
        meta=meta,
        styles=styles,
        furniture=furniture,
        out_dir=out_dir,
        snapshot_path=snapshot_path,
        volume_flowables=volume_flowables,
        check_cancelled=check_cancelled,
    )
    total = None
    if n > 1:  # counting pass: the real pass needs N for "page n / N"
        counts = []
        for k, part in enumerate(parts):
            check_cancelled()
            pm = _build(doc, part, os.devnull, offset=0, total=None, progress=tracker.window(k), **common)
            counts.append(pm.page_count)
        total = sum(counts)
    out: list[PdfPart] = []
    offset, first = 0, 0 if n == 1 else n
    for k, part in enumerate(parts):
        check_cancelled()
        path = out_dir / names[k]
        pm = _build(
            doc, part, str(path), offset=offset, total=total, progress=tracker.window(first + k), **common
        )
        offset += pm.page_count
        out.append(PdfPart(names[k], path, pm.page_count, path.stat().st_size, _sha256(path)))
    tracker.window(tracker.builds - 1)(1.0)
    return out
