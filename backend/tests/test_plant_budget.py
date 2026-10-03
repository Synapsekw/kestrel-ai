# backend/tests/test_plant_budget.py
"""RunBudget is shared by the orchestrator and up to 8 sub-run threads (spec §8.4)."""

import threading

from app.asset_models.agent.plant.budget import (
    COST_LABEL,
    PlantLimits,
    RunBudget,
    estimate_cost_usd,
    limits_from,
    load_default_limits,
    resolve_limits,
)


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_charges_sum_over_threads():
    b = RunBudget(PlantLimits(max_tokens=10**9))

    def work():
        for _ in range(1000):
            b.charge({"input_tokens": 3, "output_tokens": 1}, "trace")
            b.charge_call("trace")

    threads = [threading.Thread(target=work) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    snap = b.snapshot("trace")
    assert snap["input_tokens"] == 24000 and snap["output_tokens"] == 8000
    assert snap["by_stage"]["trace"] == {
        "input_tokens": 24000,
        "output_tokens": 8000,
        "calls": 8000,
        "images": 0,
    }
    assert snap["current"] == "trace" and b.tokens() == 32000


def test_token_limit_exhausts():
    b = RunBudget(PlantLimits(max_tokens=100))
    b.charge({"input_tokens": 60, "output_tokens": 39}, "survey")
    assert b.exhausted() is None
    b.charge({"input_tokens": 1, "output_tokens": 0}, "survey")
    assert b.exhausted() == "tokens"


def test_clock_limit_counts_time_from_before_a_restart():
    clock = Clock()
    b = RunBudget(PlantLimits(max_seconds=100), elapsed_s=90, clock=clock)
    assert b.exhausted() is None
    clock.t += 11
    assert b.exhausted() == "time" and round(b.elapsed_s()) == 101


def test_images_stop_at_the_run_limit_without_ending_the_run():
    b = RunBudget(PlantLimits(max_images=2))
    assert [b.charge_image("trace") for _ in range(3)] == [True, True, False]
    assert b.exhausted() is None and b.snapshot("trace")["by_stage"]["trace"]["images"] == 2


def test_a_resumed_budget_keeps_earlier_usage():
    b = RunBudget(PlantLimits())
    b.charge({"input_tokens": 5, "output_tokens": 5}, "survey")
    b.charge_call("survey")
    again = RunBudget(PlantLimits(), used=b.snapshot("trace"))
    assert again.tokens() == 10 and again.snapshot("trace")["by_stage"]["survey"]["calls"] == 1


def test_unknown_usage_keys_and_bad_values_are_ignored():
    b = RunBudget(PlantLimits())
    b.charge({"input_tokens": "x", "output_tokens": None, "other": 5}, "trace")
    b.charge(None, "trace")
    assert b.tokens() == 0


def test_cost_estimate_is_labelled_and_known_models_only():
    assert estimate_cost_usd("claude-opus-5-5", {"input_tokens": 1_000_000, "output_tokens": 100_000}) == 6.0
    assert estimate_cost_usd("some-other-model", {"input_tokens": 1}) is None
    assert "estimate" in COST_LABEL.lower()


class FakeAppData:
    def __init__(self, values=None, boom=False):
        self.values, self.boom = values or {}, boom

    def read_settings(self):
        if self.boom:
            raise OSError("C:/secret/settings.json")
        return self.values


def test_settings_defaults_are_clamped_and_overridable(caplog):
    data = FakeAppData({"plant_run_limits": {"max_tokens": 5, "parallel": 99, "max_images": "x"}})
    lim = load_default_limits(data)
    assert lim.max_tokens == 100_000 and lim.parallel == 8 and lim.max_images == 400
    assert resolve_limits(data, {"parallel": 2}).parallel == 2
    assert resolve_limits(None, None) == PlantLimits()
    assert load_default_limits(FakeAppData(boom=True)) == PlantLimits()
    assert "secret" not in caplog.text


def test_limits_from_round_trips_without_clamping():
    lim = PlantLimits(max_tokens=1000, parallel=2)
    from dataclasses import asdict

    assert limits_from(asdict(lim)) == lim
    assert limits_from({"junk": 1}) == PlantLimits()
