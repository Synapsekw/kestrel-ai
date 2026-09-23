"""Counts over time across a project's maps (spec 2026-09-23-survey-timeline section 4).

Every number here was computed elsewhere: `MapRun.counts` is written by a detection run over one
map. This module only decides which run speaks for a survey and which surveys may be compared, so
that a change of model can never read as a change on the ground.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from app.db.models import GeoMap, MapRun


@dataclass(frozen=True)
class Basis:
    """What "comparable" means for this timeline: one model at one confidence."""

    model_id: str | None
    model_name: str | None
    conf: float


@dataclass(frozen=True)
class Survey:
    map_id: str
    map_name: str
    captured_on: date | None
    date_is_import_date: bool
    run_id: str | None
    model_name: str | None
    conf: float | None
    counts: dict[str, int] = field(default_factory=dict)
    verified_counts: dict[str, int] = field(default_factory=dict)
    pinned: bool = False
    deltas: dict[str, int] = field(default_factory=dict)
    state: str = "not_counted"  # ok | not_comparable | not_counted
    reason: str | None = None


def choose_basis(runs: list[MapRun]) -> Basis | None:
    """The newest run's model and confidence, until the operator chooses another."""
    newest = max(runs, key=lambda r: r.created_at, default=None)
    if newest is None:
        return None
    return Basis(model_id=newest.model_id, model_name=newest.model_name, conf=newest.conf)


def _survey_date(m: GeoMap) -> tuple[date, bool]:
    """The survey's date, and whether it is really just the import date."""
    return (m.captured_on, False) if m.captured_on else (m.created_at.date(), True)


def _differs(run: MapRun, basis: Basis) -> str | None:
    """What makes this run incomparable with the basis, or None."""
    if run.model_id != basis.model_id:
        other, want = run.model_name or "unknown", basis.model_name or "unknown"
        return f"different model ({other}, not {want})"
    if run.conf != basis.conf:
        return f"confidence {run.conf} vs {basis.conf}"
    return None


def _pick(runs: list[MapRun], basis: Basis) -> tuple[MapRun | None, str | None]:
    """The operator's pinned run; else the newest run on the basis; failing that the newest run at
    all. With what makes the chosen run incomparable, if anything: a pin chooses the run that
    speaks for the survey, it never makes a different model comparable."""
    pinned = [r for r in runs if r.pinned]
    if pinned:
        run = max(pinned, key=lambda r: r.created_at)
        return run, _differs(run, basis)
    matching = [r for r in runs if r.model_id == basis.model_id and r.conf == basis.conf]
    if matching:
        return max(matching, key=lambda r: r.created_at), None
    if not runs:
        return None, None
    newest = max(runs, key=lambda r: r.created_at)
    return newest, _differs(newest, basis)


def _as_counts(value: dict | None) -> dict[str, int]:
    return {str(k): int(v) for k, v in (value or {}).items()}


def build_timeline(
    maps: list[GeoMap],
    runs_by_map: dict[str, list[MapRun]],
    basis: Basis | None,
    *,
    verified_only: bool = False,
) -> list[Survey]:
    """Surveys oldest first, each with its counts and the change since the previous comparable one.

    With `verified_only`, `counts` (and so the deltas) are the runs' verified counts: what a
    person accepted, edited or drew."""
    ordered = sorted(maps, key=lambda m: (_survey_date(m)[0], m.created_at))
    out: list[Survey] = []
    previous: dict[str, int] | None = None
    for m in ordered:
        when, from_import = _survey_date(m)
        run, reason = _pick(runs_by_map.get(m.id, []), basis) if basis else (None, None)
        verified = _as_counts(run.verified_counts) if run else {}
        counts = verified if verified_only else (_as_counts(run.counts) if run else {})
        state = "not_counted" if run is None else ("not_comparable" if reason else "ok")
        deltas: dict[str, int] = {}
        if state == "ok" and previous is not None:
            # A class missing from the earlier survey gets no delta: it did not exist to be counted.
            deltas = {c: n - previous[c] for c, n in counts.items() if c in previous}
        out.append(
            Survey(
                map_id=m.id,
                map_name=m.name,
                captured_on=when,
                date_is_import_date=from_import,
                run_id=run.id if run else None,
                model_name=run.model_name if run else None,
                conf=run.conf if run else None,
                counts=counts,
                verified_counts=verified,
                pinned=bool(run.pinned) if run else False,
                deltas=deltas,
                state=state,
                reason=reason,
            )
        )
        if state == "ok":
            previous = counts
    return out
