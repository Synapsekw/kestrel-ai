"""Grouping sightings into findings (spec 2026-10-02-asset-findings §6.4; decisions A1 and A3).

`group_sightings` is the pure port of the kit's `records.py` lines 142 to 160. It runs union-find
over sightings of one type. Two sightings join when their placed centres are at most `cluster_m`
apart, or when they share a `group_tag`. A spatial hash with `cluster_m` cells keeps it O(n): two
centres within `cluster_m` always sit in neighbouring cells. The kit compared every pair.

`apply_groups` writes groups as findings under the Regroup rules, in the caller's transaction.
`merge` and `split` are the operator's explicit actions. They are synchronous routes because they
touch a few dozen rows. Grouping never runs on an edit (decision A3): only the `asset_group` job
(import, Regroup, after `asset_place`) calls `apply_groups`.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from operator import attrgetter

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.db.models import AssetModel, Box, Finding, FindingSighting
from app.errors import AppError, not_found
from app.findings import activity, events, service, sightings
from app.findings.anchors import AnchorIn
from app.findings.numbers import allocate, format_number

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


MIN_CLUSTER_M = 0.75
CLUSTER_SHARE_OF_HEIGHT = 0.02


@dataclass
class GroupResult:
    created: int = 0  # new findings from sightings no finding held
    kept: int = 0  # groups whose finding survived (unchanged or not)
    merged: int = 0  # findings closed because their group's survivor has a lower number
    split: int = 0  # new findings made from sightings another finding held


def cluster_m_for(model: AssetModel) -> float:
    """The review's `cluster_m`, else max(0.75, 0.02 H) (spec §6.4)."""
    review = model.review or {}
    if review.get("cluster_m"):
        return float(review["cluster_m"])
    height = float((model.frame or {}).get("height_m") or 0.0)
    return max(MIN_CLUSTER_M, CLUSTER_SHARE_OF_HEIGHT * height)


def load_items(s: Session, asset_model_id: str) -> list[GroupItem]:
    """One model's sightings as grouping sees them. Scalar columns only, one row per sighting
    (bounded: 1,441 rows for DAMAC). The type is the box's class."""
    q = (
        select(
            FindingSighting.id,
            Box.class_id,
            FindingSighting.placement,
            FindingSighting.cx,
            FindingSighting.cy,
            FindingSighting.cz,
            FindingSighting.group_tag,
            FindingSighting.image_id,
        )
        .join(Box, Box.id == FindingSighting.annotation_id)
        .where(FindingSighting.asset_model_id == asset_model_id)
        .order_by(FindingSighting.created_at, FindingSighting.id)
    )
    return [
        GroupItem(
            id=sid,
            type_id=class_id,
            center=(cx, cy, cz) if placement in sightings.PLACED and cx is not None else None,
            group_tag=tag,
            image_id=image_id,
        )
        for sid, class_id, placement, cx, cy, cz, tag, image_id in s.execute(q).all()
    ]


def groups_for_model(model: AssetModel, items: Sequence[GroupItem]) -> list[list[str]]:
    """The photo unit groups by photo (one finding per photo, coordinator ruling from J5 N3/N7).
    The region unit, or a model with no review, clusters by distance and tag (spec §6.4)."""
    if (model.review or {}).get("finding_unit") == "photo":
        return group_by_photo(items)
    return group_sightings(items, cluster_m_for(model))


def _new_finding(
    s: Session,
    *,
    project_id: str,
    catalogue,
    asset_model_id: str,
    members: Sequence[FindingSighting],
    type_id: str,
    number: int | None = None,
    record_activity: bool = True,
) -> Finding:
    """A finding for `members`. Its severity is their maximum, set only here, on creation (spec
    §6.4); with no graded sighting it is the type's default."""
    levels = [m.severity for m in members if m.severity is not None]
    extra = {"severity": max(levels)} if levels else {}
    return service.create_in_session(
        s,
        project_id=project_id,
        catalogue=catalogue,
        type_id=type_id,
        anchor=AnchorIn(kind="asset", asset_model_id=asset_model_id),
        number=number,
        record_activity=record_activity,
        **extra,
    )


def _close_merged(
    s: Session, *, project_id: str, catalogue, loser: Finding, survivor: Finding, text: str, author: str
) -> None:
    activity.record(
        s,
        "finding.merged",
        loser.id,
        f"{format_number(loser.number)} merged into {format_number(survivor.number)}",
        {"into": survivor.id},
    )
    sightings.close_with_comment(
        s, project_id=project_id, catalogue=catalogue, finding=loser, text=text, author=author
    )


def apply_groups(s: Session, handle, asset_model_id: str, groups: Sequence[Sequence[str]]) -> GroupResult:
    """Write `groups` (from `group_sightings`) as findings, under the Regroup rules of spec §6.4 (see
    plan J4 Task 3). One transaction: the caller's. A sighting deleted since the groups were
    computed is dropped, and a group left empty is skipped."""
    model = s.get(AssetModel, asset_model_id)
    if model is None:
        raise not_found("asset model", asset_model_id)
    rows: dict[str, FindingSighting] = {}
    type_of: dict[str, str] = {}
    q = (
        select(FindingSighting, Box.class_id)
        .join(Box, Box.id == FindingSighting.annotation_id)
        .where(FindingSighting.asset_model_id == asset_model_id)
    )
    for sighting, class_id in s.execute(q).all():
        rows[sighting.id] = sighting
        type_of[sighting.id] = class_id
    live = [[sid for sid in g if sid in rows] for g in groups]
    live = [g for g in live if g]
    findings = {
        f.id: f
        for f in s.execute(
            select(Finding).where(Finding.anchor_kind == "asset", Finding.asset_model_id == asset_model_id)
        ).scalars()
    }
    current: dict[str, set[str]] = defaultdict(set)
    for sid, row in rows.items():
        if row.finding_id:
            current[row.finding_id].add(sid)
    share: dict[str, Counter] = defaultdict(Counter)
    for gi, g in enumerate(live):
        for sid in g:
            if rows[sid].finding_id:
                share[rows[sid].finding_id][gi] += 1
    homes: dict[int, list[Finding]] = defaultdict(list)
    for fid, per_group in share.items():
        home = max(sorted(per_group), key=per_group.__getitem__)  # most sightings; ties: the higher group
        homes[home].append(findings[fid])

    result = GroupResult()
    touched: set[str] = set()
    merges: list[tuple[Finding, Finding]] = []
    kept: list[Finding] = []
    fresh: list[tuple[list[str], set[str]]] = []
    for gi, g in enumerate(live):
        candidates = sorted(homes.get(gi, []), key=attrgetter("number"))
        if not candidates:
            fresh.append((g, {rows[sid].finding_id for sid in g if rows[sid].finding_id}))
            continue
        # The lowest number that is not closed survives; a closed one only when all are (ruling R15).
        survivor = next((f for f in candidates if f.status != "closed"), candidates[0])
        losers = [f for f in candidates if f is not survivor]
        result.kept += 1
        kept.append(survivor)
        if not losers and current[survivor.id] == set(g):
            continue  # the same sightings: refreshed below, written only when placement moved it
        for sid in g:
            if rows[sid].finding_id:
                touched.add(rows[sid].finding_id)
            rows[sid].finding_id = survivor.id
        touched.add(survivor.id)
        merges += [(loser, survivor) for loser in losers]

    first = allocate(s, count=len(fresh)) if fresh else 0  # one block: new numbers read top-down
    for i, (g, sources) in enumerate(fresh):
        members = [rows[sid] for sid in g]
        new = _new_finding(
            s,
            project_id=handle.id,
            catalogue=handle.catalogue,
            asset_model_id=asset_model_id,
            members=members,
            type_id=type_of[g[0]],
            number=first + i,
            record_activity=False,  # one `findings.grouped` row instead of hundreds
        )
        findings[new.id] = new
        for m in members:
            m.finding_id = new.id
        touched |= sources | {new.id}
        if sources:
            result.split += 1
            for src in sorted(sources):
                old = format_number(findings[src].number)
                activity.record(
                    s,
                    "finding.split",
                    src,
                    f"{format_number(new.number)} split from {old} by Regroup",
                    {"new_id": new.id},
                )
        else:
            result.created += 1
    s.flush()
    # A survivor whose sightings did not change is still refreshed: `asset_place` only writes
    # sighting columns and leaves the finding to grouping (ruling R14, plan note N3).
    moved = set(touched)
    for fid in sorted(moved | {f.id for f in kept}):
        if sightings.refresh(s, findings[fid]):
            touched.add(fid)
        elif fid in moved:
            findings[fid].updated_at = utcnow()  # its sightings changed, if not its columns
    for loser, survivor in merges:
        _close_merged(
            s,
            project_id=handle.id,
            catalogue=handle.catalogue,
            loser=loser,
            survivor=survivor,
            text=f"Merged into {format_number(survivor.number)} by Regroup.",
            author=sightings.SYSTEM_AUTHOR,
        )
        result.merged += 1
    activity.record(
        s,
        "findings.grouped",
        asset_model_id,
        f"Grouped sightings on {model.name}: {result.created} new, {result.kept} kept, "
        f"{result.merged} merged, {result.split} split",
        asdict(result),
    )
    events.mark_changed(s, handle.id, touched)
    return result


def _asset_finding(s: Session, finding_id: str, code: str) -> Finding:
    """The finding (404 when unknown), or 422 `code` with reason `not_asset` (the contract's
    `invalid_merge` or `invalid_split`)."""
    f = service.get_or_404(s, finding_id)
    if f.anchor_kind != "asset":
        raise AppError(
            code,
            f"{format_number(f.number)} is not on an asset model; only asset findings merge and split.",
            422,
            {"reason": "not_asset", "finding_id": f.id},
        )
    return f


def merge(
    s: Session, handle, finding_id: str, into_id: str, *, author: str = sightings.SYSTEM_AUTHOR
) -> Finding:
    """The operator merges `finding_id` into `into_id`. Every sighting moves to the survivor. The
    source is closed with a comment naming the survivor and keeps its note, comments and photos.
    Returns the survivor."""
    if finding_id == into_id:
        raise AppError(
            "invalid_merge", "A finding cannot be merged into itself.", 422, {"reason": "same_finding"}
        )
    src, dst = _asset_finding(s, finding_id, "invalid_merge"), _asset_finding(s, into_id, "invalid_merge")
    if src.asset_model_id != dst.asset_model_id:
        raise AppError(
            "invalid_merge", "Both findings must be on the same asset model.", 422, {"reason": "other_model"}
        )
    if src.type_id != dst.type_id:
        raise AppError(
            "invalid_merge", "Both findings must have the same type.", 422, {"reason": "other_type"}
        )
    for row in sightings.of_finding(s, src.id):
        row.finding_id = dst.id
    s.flush()
    sightings.refresh(s, dst)
    sightings.refresh(s, src)
    _close_merged(
        s,
        project_id=handle.id,
        catalogue=handle.catalogue,
        loser=src,
        survivor=dst,
        text=f"Merged into {format_number(dst.number)}.",
        author=author,
    )
    events.mark_changed(s, handle.id, [src.id, dst.id])
    return dst


def split_in_session(
    s: Session,
    *,
    project_id: str,
    catalogue,
    finding_id: str,
    sighting_ids: Sequence[str],
    type_id: str | None = None,
) -> Finding:
    """Move `sighting_ids` out of `finding_id` into a new finding, of `type_id` (default: the
    source's type). The source keeps at least one sighting. Returns the new finding."""
    src = _asset_finding(s, finding_id, "invalid_split")
    ids = list(dict.fromkeys(sighting_ids))
    owned = {r.id: r for r in sightings.of_finding(s, src.id)}
    foreign = [i for i in ids if i not in owned]
    if not ids or foreign:
        raise AppError(
            "invalid_split",
            "Every sighting must belong to this finding.",
            422,
            {"reason": "not_on_finding", "sighting_ids": foreign[:20]},
        )
    if len(ids) == len(owned):
        raise AppError(
            "invalid_split",
            "Leave at least one sighting on the finding; a split takes some, not all.",
            422,
            {"reason": "all_sightings"},
        )
    members = [owned[i] for i in ids]
    new = _new_finding(
        s,
        project_id=project_id,
        catalogue=catalogue,
        asset_model_id=src.asset_model_id,
        members=members,
        type_id=type_id or src.type_id,
    )
    for m in members:
        m.finding_id = new.id
    s.flush()
    sightings.refresh(s, new)
    sightings.refresh(s, src)
    activity.record(
        s,
        "finding.split",
        src.id,
        f"{format_number(new.number)} split from {format_number(src.number)}",
        {"new_id": new.id, "sightings": len(members)},
    )
    events.mark_changed(s, project_id, [src.id, new.id])
    return new


def split(s: Session, handle, finding_id: str, sighting_ids: Sequence[str]) -> Finding:
    return split_in_session(
        s, project_id=handle.id, catalogue=handle.catalogue, finding_id=finding_id, sighting_ids=sighting_ids
    )
