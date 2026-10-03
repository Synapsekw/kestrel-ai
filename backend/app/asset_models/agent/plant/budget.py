# backend/app/asset_models/agent/plant/budget.py
"""Plant run limits, the run budget shared by every conversation, and the cost estimate (spec §8.4).

`RunBudget` is charged from the orchestrator thread and from up to `parallel` sub-run threads, so
every read and write holds one lock. Usage keeps a per-stage split for the Run tab
(`usage_by_stage`)."""

from __future__ import annotations

import logging
import math
import threading
import time
from dataclasses import dataclass, fields, replace

log = logging.getLogger(__name__)

SETTINGS_KEY = "plant_run_limits"
STAGES = ("survey", "trace", "merge", "cloud_check", "review", "environment", "build")
_COUNTERS = ("input_tokens", "output_tokens", "calls", "images")


@dataclass(frozen=True)
class PlantLimits:
    max_tokens: int = 40_000_000
    max_images: int = 400
    max_seconds: int = 14_400
    parallel: int = 4
    sub_calls: int = 150
    sub_tokens: int = 4_000_000
    sub_images: int = 60


BOUNDS = {
    "max_tokens": (100_000, 200_000_000),
    "max_images": (0, 2_000),
    "max_seconds": (60, 43_200),
    "parallel": (1, 8),
    "sub_calls": (5, 1_000),
    "sub_tokens": (50_000, 40_000_000),
    "sub_images": (0, 400),
}


def _clean(values: dict, base: PlantLimits) -> PlantLimits:
    out = {}
    for key, (lo, hi) in BOUNDS.items():
        v = values.get(key)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            continue
        out[key] = int(min(max(v, lo), hi))
    return replace(base, **out)


def load_default_limits(appdata) -> PlantLimits:
    """settings.json `plant_run_limits`, clamped; defaults when missing or unreadable (logged, no text)."""
    try:
        values = appdata.read_settings().get(SETTINGS_KEY) or {}
    except Exception as e:  # noqa: BLE001 - an unreadable settings file never blocks a run
        log.warning("plant run limits could not be read (%s); using defaults", type(e).__name__)
        return PlantLimits()
    return _clean(values, PlantLimits()) if isinstance(values, dict) else PlantLimits()


def resolve_limits(appdata, override: dict | None) -> PlantLimits:
    base = load_default_limits(appdata) if appdata is not None else PlantLimits()
    return _clean(override or {}, base)


def limits_from(d: dict | None) -> PlantLimits:
    """The limits a run stored at start (already clamped by the route; tests store small ones)."""
    known = {f.name for f in fields(PlantLimits)}
    return PlantLimits(**{k: int(v) for k, v in (d or {}).items() if k in known})


@dataclass(frozen=True)
class Price:
    input_usd_mtok: float
    output_usd_mtok: float


# List prices per million tokens (claude-api skill, cached 2026-09-25). An estimate, not a bill:
# llm.complete folds cache reads into input_tokens, so cached input is priced as fresh input.
PRICE_TABLE: dict[str, Price] = {
    "claude-opus-5-5": Price(4.00, 20.00),
    "claude-opus-5": Price(5.00, 25.00),
    "claude-sonnet-5-5": Price(2.00, 10.00),
    "claude-fable-5-1": Price(10.00, 50.00),
}
COST_LABEL = "Estimate from list prices, not a bill. Cached input is priced as fresh input."


def estimate_cost_usd(model_name: str, usage: dict) -> float | None:
    price = PRICE_TABLE.get(model_name)
    if price is None:
        return None
    tin = int(usage.get("input_tokens", 0) or 0)
    tout = int(usage.get("output_tokens", 0) or 0)
    return round((tin * price.input_usd_mtok + tout * price.output_usd_mtok) / 1_000_000, 2)


def _int(v) -> int:
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else 0


class RunBudget:
    def __init__(
        self, limits: PlantLimits, *, used: dict | None = None, elapsed_s: float = 0.0, clock=time.monotonic
    ):
        self.limits = limits
        self._clock = clock
        self._lock = threading.Lock()
        self._t0 = clock() - float(elapsed_s or 0.0)
        earlier = (used or {}).get("by_stage") or {}
        self._stages: dict[str, dict[str, int]] = {}
        for stage, row in earlier.items():
            if isinstance(row, dict):
                self._stages[str(stage)] = {k: _int(row.get(k)) for k in _COUNTERS}

    def _row(self, stage: str) -> dict[str, int]:
        return self._stages.setdefault(stage, dict.fromkeys(_COUNTERS, 0))

    def charge(self, usage: dict | None, stage: str) -> None:
        if not isinstance(usage, dict):
            return
        with self._lock:
            row = self._row(stage)
            row["input_tokens"] += _int(usage.get("input_tokens"))
            row["output_tokens"] += _int(usage.get("output_tokens"))

    def charge_call(self, stage: str) -> None:
        with self._lock:
            self._row(stage)["calls"] += 1

    def charge_image(self, stage: str) -> bool:
        with self._lock:
            if sum(r["images"] for r in self._stages.values()) >= self.limits.max_images:
                return False
            self._row(stage)["images"] += 1
            return True

    def tokens(self) -> int:
        with self._lock:
            return sum(r["input_tokens"] + r["output_tokens"] for r in self._stages.values())

    def elapsed_s(self) -> float:
        return self._clock() - self._t0

    def exhausted(self) -> str | None:
        if self.tokens() >= self.limits.max_tokens:
            return "tokens"
        if self.elapsed_s() >= self.limits.max_seconds:
            return "time"
        return None

    def snapshot(self, current: str) -> dict:
        with self._lock:
            by_stage = {s: dict(r) for s, r in self._stages.items()}
        return {
            "input_tokens": sum(r["input_tokens"] for r in by_stage.values()),
            "output_tokens": sum(r["output_tokens"] for r in by_stage.values()),
            "current": current,
            "by_stage": by_stage,
        }
