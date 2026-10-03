# backend/app/asset_models/agent/plant/state.py
"""What a plant run keeps on disk so it can resume (spec §8.4), under `<run_dir>/plant/`:
- `state.json`: stage, frame, environment, package briefs, interrupt counts, limits, notes;
- `packages/<n>.json`: a finished package's items;
- `merged.json`: the merged item list once merge has run.

The spec data only; never prompts, model text, keys or paths."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

from app.asset_models.spec import EnvFeature, Item, SiteFrame

STAGE_ORDER = ("survey", "trace", "merge", "cloud_check", "review", "environment", "build", "done")


@dataclass
class PlantState:
    stage: str = "survey"
    site: dict | None = None
    environment: list[dict] = field(default_factory=list)
    packages_meta: dict[str, dict] = field(default_factory=dict)  # package id -> {brief, expected_tags}
    interrupts: dict[str, int] = field(default_factory=dict)  # package id -> times cut off while running
    run_interrupts: int = 0
    elapsed_s: float = 0.0
    limits: dict = field(default_factory=dict)
    package_ids: list[str] = field(default_factory=list)  # plant_package: the packages being redone
    base_version: int | None = None
    questions: list[str] = field(default_factory=list)  # open questions raised by tools (app text)
    notes: list[str] = field(default_factory=list)  # app-written run notes (cloud check skipped, ...)
    fix_rounds: int = 0
    candidates: list[dict] = field(default_factory=list)
    check_summary: str | None = None  # the cloud check's digest (C1 summarise), shown in the review stage


def plant_dir(run_dir: Path) -> Path:
    return Path(run_dir) / "plant"


def _atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def load_state(run_dir: Path) -> PlantState:
    path = plant_dir(run_dir) / "state.json"
    if not path.exists():
        return PlantState()
    raw = json.loads(path.read_text("utf-8"))
    known = {f.name for f in fields(PlantState)}
    return PlantState(**{k: v for k, v in raw.items() if k in known})


def save_state(run_dir: Path, st: PlantState) -> None:
    _atomic(plant_dir(run_dir) / "state.json", json.dumps(asdict(st), separators=(",", ":")))


def _dump(items: list[Item]) -> str:
    return json.dumps([i.model_dump(mode="json") for i in items], separators=(",", ":"))


def _load(path: Path) -> list[Item] | None:
    if not path.exists():
        return None
    return [Item.model_validate(x) for x in json.loads(path.read_text("utf-8"))]


def save_package_items(run_dir: Path, n: int, items: list[Item]) -> None:
    _atomic(plant_dir(run_dir) / "packages" / f"{int(n)}.json", _dump(items))


def load_package_items(run_dir: Path, n: int) -> list[Item] | None:
    return _load(plant_dir(run_dir) / "packages" / f"{int(n)}.json")


def save_merged(run_dir: Path, items: list[Item]) -> None:
    _atomic(plant_dir(run_dir) / "merged.json", _dump(items))


def load_merged(run_dir: Path) -> list[Item] | None:
    return _load(plant_dir(run_dir) / "merged.json")


def site_of(st: PlantState) -> SiteFrame | None:
    return SiteFrame.model_validate(st.site) if st.site else None


def env_of(st: PlantState) -> list[EnvFeature]:
    return [EnvFeature.model_validate(x) for x in st.environment]
