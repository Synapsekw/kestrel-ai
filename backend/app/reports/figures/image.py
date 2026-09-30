"""Image figures, photos and comments of a finding page (spec §7.3). R2 stub -> R9-I fills the
bodies; the signatures are fixed (index "Interface decisions").
A figure module may also define `warnings(ctx) -> None`; the outline calls it (plan R2 Ruling 11),
and `fingerprint(ctx) -> str`; finding_pages appends it to the section etag, so an input the figures
read that no finding row carries can still move the preview.
The image hook also runs when photos or comments print, even with "image" snapshots off."""

from __future__ import annotations

from app.reports.blocks import Comment, Figure
from app.reports.context import ComposeContext, FindingRow


def finding_figures(ctx: ComposeContext, finding: FindingRow) -> list[Figure]:
    return []


def photos(ctx: ComposeContext, finding: FindingRow, max_n: int) -> list[Figure]:
    return []


def comments(ctx: ComposeContext, finding: FindingRow, mode: str) -> list[Comment]:
    return []
