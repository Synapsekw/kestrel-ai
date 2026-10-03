"""Grouping sightings into findings (spec 2026-10-02-asset-findings §6.4; decisions A1 and A3).

`group_sightings` is the pure port of the kit's `records.py` lines 142 to 160. It runs union-find
over sightings of one type. Two sightings join when their placed centres are at most `cluster_m`
apart, or when they share a `group_tag`. A spatial hash with `cluster_m` cells keeps it O(n): two
centres within `cluster_m` always sit in neighbouring cells. The kit compared every pair.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

Vec3 = tuple[float, float, float]
_NEIGHBOURS = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)]


@dataclass(frozen=True)
class GroupItem:
    """One sighting as grouping sees it: its id, its type (its box's class) and, when it is placed,
    its centre in the asset frame."""

    id: str
    type_id: str
    center: Vec3 | None = None
    group_tag: str | None = None
    image_id: str | None = None  # the photo; the photo unit groups by it


def _ordered(items: Sequence[GroupItem], members: list[list[int]]) -> list[list[str]]:
    """Placed groups first, then by their highest centre, highest first; ties by the smallest id."""

    def order(group: list[int]) -> tuple[bool, float, str]:
        heights = [items[i].center[1] for i in group if items[i].center is not None]
        return (not heights, -max(heights) if heights else 0.0, min(items[i].id for i in group))

    return [sorted(items[i].id for i in g) for g in sorted(members, key=order)]


def group_by_photo(items: Sequence[GroupItem]) -> list[list[str]]:
    """The photo unit (review `finding_unit == "photo"`, e.g. the stack profile): one finding per
    photo, so every sighting on one image forms one group. Distance and tags are ignored, and
    unplaced sightings follow their photo. The key also holds the type, because a finding has one
    type."""
    members: dict[tuple[str | None, str], list[int]] = defaultdict(list)
    for i, item in enumerate(items):
        key = (item.image_id, item.type_id) if item.image_id is not None else (f"#{item.id}", item.type_id)
        members[key].append(i)
    return _ordered(items, list(members.values()))


class _UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        parent = self.parent
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(self, i: int, j: int) -> None:
        a, b = self.find(i), self.find(j)
        if a != b:
            self.parent[max(a, b)] = min(a, b)


def _cell(center: Vec3, size: float) -> tuple[int, int, int]:
    return (math.floor(center[0] / size), math.floor(center[1] / size), math.floor(center[2] / size))


def group_sightings(items: Sequence[GroupItem], cluster_m: float) -> list[list[str]]:
    """Groups of sighting ids, each sorted.

    Groups come placed first, then by their highest centre, highest first, so numbers given in this
    order read top-down. Ties go to the smallest id, so the order is deterministic. An unplaced
    sighting is a group of its own unless a tag joins it."""
    if not (math.isfinite(cluster_m) and cluster_m > 0):
        raise ValueError("cluster_m must be a positive number of metres")
    uf = _UnionFind(len(items))
    cells: dict[tuple[str, int, int, int], list[int]] = defaultdict(list)
    for i, item in enumerate(items):
        if item.center is None:
            continue
        cx, cy, cz = _cell(item.center, cluster_m)
        for dx, dy, dz in _NEIGHBOURS:
            for j in cells.get((item.type_id, cx + dx, cy + dy, cz + dz), ()):
                if math.dist(item.center, items[j].center) <= cluster_m:
                    uf.union(i, j)
        cells[(item.type_id, cx, cy, cz)].append(i)
    tagged: dict[tuple[str, str], int] = {}
    for i, item in enumerate(items):
        if item.group_tag:
            first = tagged.setdefault((item.type_id, item.group_tag), i)
            if first != i:
                uf.union(i, first)
    members: dict[int, list[int]] = defaultdict(list)
    for i in range(len(items)):
        members[uf.find(i)].append(i)
    return _ordered(items, list(members.values()))
