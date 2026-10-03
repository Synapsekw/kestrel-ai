"""Match kit photos to a project's images (spec 2026-10-02-asset-findings §6.5 step 2).

In order: the kit's `source_name` equals `image.original_name` (both relative paths, compared
without case or slash style); one path is a suffix of the other on a folder boundary; the file
names are equal; then the capture time to the second and the original size. A step that finds
more than one candidate never picks one: the photo is reported, nothing is guessed. An image is
claimed by one kit photo at most.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import PurePosixPath

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.asset_review.kit_format import KitPhoto
from app.db.models import Image

KIT_TIME = "%Y:%m:%d %H:%M:%S"
ASPECT_SLACK = 0.005  # without the original size, the stored copy's aspect stands in for it


@dataclass(frozen=True)
class Candidate:
    image_id: str
    name: str  # Image.original_name (relative to the source folder), else the stored file name
    width: int
    height: int
    orig_w: int | None
    orig_h: int | None
    capture_time: datetime | None


@dataclass(frozen=True)
class Match:
    image_id: str
    width: int  # the stored image's pixels: what box rows are in
    height: int
    by: str  # path | suffix | name | time_size


@dataclass
class MatchResult:
    matched: dict[str, Match] = field(default_factory=dict)
    unmatched: list[dict] = field(default_factory=list)


def norm(path: str | None) -> str:
    p = (path or "").replace("\\", "/").strip().lower()
    while p.startswith("./"):
        p = p[2:]
    return p.lstrip("/")


def _naive_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.astimezone(UTC).replace(tzinfo=None) if dt.tzinfo else dt


def kit_time(text: str | None) -> datetime | None:
    """The kit writes EXIF DateTimeOriginal as is; the importer stores it as UTC (prepare.read_exif)."""
    try:
        return datetime.strptime(str(text).strip(), KIT_TIME)
    except (TypeError, ValueError):
        return None


def load_candidates(s: Session, source_id: str) -> list[Candidate]:
    """One image set's rows as small tuples (DAMAC: 4,538). No image file is opened."""
    q = select(
        Image.id,
        Image.original_name,
        Image.path,
        Image.width,
        Image.height,
        Image.orig_w,
        Image.orig_h,
        Image.capture_time,
    ).where(Image.source_id == source_id)
    return [
        Candidate(i, original or PurePosixPath(path).name, w, h, ow, oh, t)
        for i, original, path, w, h, ow, oh, t in s.execute(q).all()
    ]


def _suffix(a: str, b: str) -> bool:
    return a == b or a.endswith("/" + b) or b.endswith("/" + a)


def _same_size(c: Candidate, p: KitPhoto) -> bool:
    if c.orig_w and c.orig_h:
        return (c.orig_w, c.orig_h) == (p.width, p.height)
    return abs(c.width * p.height - c.height * p.width) <= ASPECT_SLACK * c.width * p.height


def _one(cands: list[Candidate]) -> tuple[Candidate | None, bool]:
    """(the candidate, False) when exactly one; (None, ambiguous) otherwise."""
    if len(cands) == 1:
        return cands[0], False
    return None, len(cands) > 1


def _find(p: KitPhoto, by_path, by_name, by_time) -> tuple[Candidate | None, str, bool]:
    key = norm(p.source_name or p.name)
    ambiguous = False
    c, amb = _one(by_path.get(key, []))
    if c is not None:
        return c, "path", False
    ambiguous |= amb
    if not amb:
        same = by_name.get(key.rsplit("/", 1)[-1], [])
        c, amb = _one([x for x in same if _suffix(norm(x.name), key)])
        if c is not None:
            return c, "suffix", False
        ambiguous |= amb
        if not amb:
            c, amb = _one(same)
            if c is not None:
                return c, "name", False
            ambiguous |= amb
    t = kit_time(p.time)
    if t is not None:
        c, amb = _one([x for x in by_time.get(t, []) if _same_size(x, p)])
        if c is not None:
            return c, "time_size", False
        ambiguous |= amb
    return None, "", ambiguous


def match_photos(photos: list[KitPhoto], candidates: list[Candidate]) -> MatchResult:
    by_path: dict[str, list[Candidate]] = defaultdict(list)
    by_name: dict[str, list[Candidate]] = defaultdict(list)
    by_time: dict[datetime, list[Candidate]] = defaultdict(list)
    for c in candidates:
        key = norm(c.name)
        by_path[key].append(c)
        by_name[key.rsplit("/", 1)[-1]].append(c)
        t = _naive_utc(c.capture_time)
        if t is not None:
            by_time[t].append(c)
    out = MatchResult()
    claimed: set[str] = set()
    for p in photos:
        found, by, ambiguous = _find(p, by_path, by_name, by_time)
        if found is None:
            reason = "ambiguous" if ambiguous else "not_found"
            out.unmatched.append({"kit_id": p.id, "source_name": p.source_name, "reason": reason})
        elif found.image_id in claimed:
            out.unmatched.append({"kit_id": p.id, "source_name": p.source_name, "reason": "duplicate"})
        else:
            claimed.add(found.image_id)
            out.matched[p.id] = Match(found.image_id, found.width, found.height, by)
    return out
