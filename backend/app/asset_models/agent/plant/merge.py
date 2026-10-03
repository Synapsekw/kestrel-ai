"""Merge the packages' item lists into one register (spec §8.2.3; ruling R9). Pure: no I/O.

Later lists are newer (a later package, or a re-run over a version). Same normalised tag: one item
survives (highest confidence, then newest); a loser of another type or more than 2 m away flags the
survivor `straddles_package`. Untagged items of one type whose footprints overlap more than 60 % of
the smaller one merge the same way, unflagged. Ids are made unique."""

from __future__ import annotations

import math
import re

from shapely import STRtree
from shapely.geometry import Polygon

from app.asset_models.siteframe import footprint_polygon, footprint_ref
from app.asset_models.spec import Item, ItemFlag

CONF = {"high": 2, "medium": 1, "low": 0}
OVERLAP = 0.6
STRADDLE_M = 2.0
_SEP = re.compile(r"[\s_]+")


def norm_tag(tag: str | None) -> str | None:
    if not tag:
        return None
    return _SEP.sub("", tag).upper() or None


def with_flag(item: Item, flag: ItemFlag) -> Item:
    flags = [f for f in item.flags if f.code != flag.code] + [flag]
    return item.model_copy(update={"flags": flags})


def _rank(entry) -> tuple[int, int]:
    k, item = entry
    return CONF.get(item.confidence, 0), k


def _poly(item: Item) -> Polygon:
    p = Polygon(footprint_polygon(item.footprint))
    return p if p.is_valid else p.buffer(0)


def merge_items(lists: list[list[Item]], labels: list[str] | None = None) -> list[Item]:
    labels = labels or [f"list {k + 1}" for k in range(len(lists))]
    entries = [(k, item) for k, items in enumerate(lists) for item in items]
    by_tag: dict[str, list] = {}
    untagged = []
    for e in entries:
        t = norm_tag(e[1].tag)
        (by_tag.setdefault(t, []) if t else untagged).append(e)
    out: list[Item] = []
    for group in by_tag.values():
        win_k, win = max(group, key=_rank)
        wx, wy = footprint_ref(win.footprint)
        worst, worst_label = None, None
        for k, other in group:
            if other is win:
                continue
            ox, oy = footprint_ref(other.footprint)
            d = math.hypot(ox - wx, oy - wy)
            if other.type != win.type or d > STRADDLE_M:
                if worst is None or d > worst:
                    worst, worst_label = d, labels[k]
        if worst is not None:
            win = with_flag(
                win,
                ItemFlag(
                    code="straddles_package",
                    value=round(worst, 2),
                    note=f"Also traced in {worst_label}, {worst:.1f} m away.",
                ),
            )
        out.append(win)
    out.extend(_merge_untagged(untagged))
    return _unique_ids(out)


def _merge_untagged(entries) -> list[Item]:
    by_type: dict[str, list] = {}
    for e in entries:
        by_type.setdefault(e[1].type, []).append(e)
    kept: list[Item] = []
    for group in by_type.values():
        polys = [_poly(item) for _, item in group]
        tree = STRtree(polys)
        alive = [True] * len(group)
        order = sorted(range(len(group)), key=lambda i: _rank(group[i]), reverse=True)
        for i in order:  # strongest first: it absorbs the weaker items it overlaps
            if not alive[i]:
                continue
            for j in tree.query(polys[i]):
                j = int(j)
                if j == i or not alive[j]:
                    continue
                smaller = min(polys[i].area, polys[j].area)
                if smaller > 0 and polys[i].intersection(polys[j]).area / smaller > OVERLAP:
                    alive[j] = False
        kept.extend(group[i][1] for i in range(len(group)) if alive[i])
    return kept


def _unique_ids(items: list[Item]) -> list[Item]:
    seen: set[str] = set()
    out = []
    for item in items:
        new, k = item.id, 1
        while new in seen:
            k += 1
            suffix = f"-{k}"
            new = item.id[: 64 - len(suffix)] + suffix
        seen.add(new)
        out.append(item if new == item.id else item.model_copy(update={"id": new}))
    return out
