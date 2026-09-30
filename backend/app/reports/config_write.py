"""Turning a raw report config into a `ReportConfig` at write time (spec 2026-09-26-reports §7.1,
§14 "PATCH returns 422 with a path per invalid field"), and template portability (§6.2).

Every refusal is one 422 whose `details.errors` lists `{path, message}` per invalid field, `path`
dotted from the request body root (`config.filters.date.to`). Schema errors (pydantic) and the
semantic rules below share that shape, so the builder can mark each field. `validation_errors` is
the same shape for a whole request body validated against one of R0's request models (plan R1
Ruling P2), used by later tasks' routes.
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from app.errors import AppError
from app.reports.schemas import ReportConfig

TITLE_MAX = 200


def invalid(code: str, message: str, errors: list[dict]) -> AppError:
    return AppError(code, message, 422, {"errors": errors})


def _join(prefix: str, loc: tuple | list) -> str:
    parts = [prefix, *(str(p) for p in loc)] if prefix else [str(p) for p in loc]
    return ".".join(p for p in parts if p) or prefix


def validation_errors(e: ValidationError, prefix: str = "") -> list[dict]:
    """Each pydantic error as `{path, message}`, `path` dotted from `prefix` (Ruling P2)."""
    return [{"path": _join(prefix, err["loc"]), "message": err["msg"]} for err in e.errors()]


def dump(config: ReportConfig) -> dict:
    """The stored form (the `report.config` / `report_template.config` JSON column)."""
    return config.model_dump(mode="json", by_alias=True)


def _dup_errors(
    values, base: str, *, key=lambda v: str(getattr(v, "value", v)), suffix: str = ""
) -> list[dict]:
    """One error per repeated value in `values`, `path` pointing at the duplicate's own index under
    `base` (`{base}.{i}{suffix}`). Shared by every `uniqueItems: true` array the contract declares
    on the report config that pydantic cannot state on its own (plan R1 Rulings 3, P7)."""
    errors: list[dict] = []
    seen: set[str] = set()
    for i, v in enumerate(values):
        k = key(v)
        if k in seen:
            errors.append({"path": f"{base}.{i}{suffix}", "message": f"{k} appears twice."})
        seen.add(k)
    return errors


def config_problems(config: ReportConfig, *, prefix: str = "config") -> list[dict]:
    """Semantic rules pydantic cannot express on one field (plan R1 Ruling 3, P7)."""
    errors: list[dict] = []
    errors += _dup_errors(
        config.sections,
        f"{prefix}.sections",
        key=lambda s: str(getattr(s.key, "value", s.key)),
        suffix=".key",
    )
    for i, section in enumerate(config.sections):
        key = str(getattr(section.key, "value", section.key))
        base = f"{prefix}.sections.{i}.options"
        if key == "findings_table":
            errors += _dup_errors(section.options.columns, f"{base}.columns")
        elif key == "finding_pages":
            errors += _dup_errors(section.options.snapshots, f"{base}.snapshots")
        elif key == "measurements":
            errors += _dup_errors(section.options.kinds, f"{base}.kinds")
    errors += _dup_errors(config.filters.statuses, f"{prefix}.filters.statuses")
    date = config.filters.date
    if date is not None:
        rule = str(getattr(date.rule, "value", date.rule))
        start, end = getattr(date, "from_", None), getattr(date, "to", None)
        base = f"{prefix}.filters.date"
        if rule == "range":
            if start is None:
                errors.append({"path": f"{base}.from", "message": "A range needs a start date."})
            if end is None:
                errors.append({"path": f"{base}.to", "message": "A range needs an end date."})
            if start is not None and end is not None and start > end:
                errors.append({"path": f"{base}.to", "message": "The end date is before the start date."})
        if rule == "last_days" and (date.days is None or date.days < 1):
            errors.append({"path": f"{base}.days", "message": "Give a number of days of 1 or more."})
    return errors


def parse_config(raw: Any, *, code: str, prefix: str = "config") -> ReportConfig:
    """`raw` as a ReportConfig, or 422 `code` with one error per invalid field."""
    try:
        config = ReportConfig.model_validate(raw)
    except ValidationError as e:
        raise invalid(code, "The report settings are not valid.", validation_errors(e, prefix)) from None
    problems = config_problems(config, prefix=prefix)
    if problems:
        raise invalid(code, "The report settings are not valid.", problems)
    return config


def parse_title(raw: Any, *, path: str = "title", max_len: int = TITLE_MAX) -> tuple[str | None, list[dict]]:
    if not isinstance(raw, str) or not raw.strip():
        return None, [{"path": path, "message": "Give a name."}]
    title = raw.strip()
    if len(title) > max_len:
        return None, [{"path": path, "message": f"Keep it to {max_len} characters."}]
    return title, []


def portable_config(config: ReportConfig) -> ReportConfig:
    """What a template may keep: no data-item ids, no project logo, no fixed report date (§6.2).

    Never mutates `config` (it may be a shared BUILTIN_TEMPLATES instance) — `deep=True` copies the
    nested models too, not just the top-level replacement.
    """
    filters = config.filters.model_copy(update={"data_item_ids": None})
    cover = config.cover.model_copy(update={"logo_asset_id": None, "report_date": None})
    return config.model_copy(update={"filters": filters, "cover": cover}, deep=True)


def config_for_project(config: ReportConfig, *, title: str) -> ReportConfig:
    """A template's config as a new report's: portable, titled (plan R1 Rulings 1-2).

    Never mutates `config`: builds on `portable_config`'s fresh copy.
    """
    out = portable_config(config)
    return out.model_copy(update={"cover": out.cover.model_copy(update={"title": title})})
