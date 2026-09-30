"""Reading report PDFs back in tests: pypdfium2 (already pinned for drawings) extracts text from the
TTF subsets, the outline and pixels. Not a test module."""

from __future__ import annotations

from pathlib import Path

from PIL import Image as PILImage


def _open(path: Path):
    import pypdfium2 as pdfium

    return pdfium.PdfDocument(str(path))


def pdf_pages_text(path: Path) -> list[str]:
    pdf = _open(path)
    try:
        out = []
        for i in range(len(pdf)):
            page = pdf[i]
            tp = page.get_textpage()
            out.append(tp.get_text_range())
            tp.close()
            page.close()
        return out
    finally:
        pdf.close()


def pdf_toc(path: Path) -> list[tuple[int, str]]:
    pdf = _open(path)
    try:
        return [(b.level, b.get_title()) for b in pdf.get_toc()]
    finally:
        pdf.close()


def pdf_page_count(path: Path) -> int:
    pdf = _open(path)
    try:
        return len(pdf)
    finally:
        pdf.close()


def pixel(path: Path, page_index: int, x_frac: float, y_frac: float) -> tuple[int, int, int]:
    """The RGB at a fraction of the page (0,0 = top left), rendered at 72 dpi."""
    pdf = _open(path)
    try:
        page = pdf[page_index]
        img = page.render(scale=1).to_pil().convert("RGB")
        page.close()
        return img.getpixel((int(img.width * x_frac), int(img.height * y_frac)))
    finally:
        pdf.close()


def jpeg(path: Path, w: int = 400, h: int = 300, rgb: tuple[int, int, int] = (90, 120, 160)) -> Path:
    """A deterministic JPEG (q85, 4:2:0, no EXIF), as the snapshot cache writes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    PILImage.new("RGB", (w, h), rgb).save(path, "JPEG", quality=85, subsampling=2)
    return path
