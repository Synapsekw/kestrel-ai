import threading
import time

from app.health import GpuProbe, probe_cuda


def answered(probe: GpuProbe, timeout: float = 5.0) -> dict:
    """Poll the probe until its background thread has an answer."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = probe.snapshot()
        if value is not None:
            return value
        time.sleep(0.01)
    raise AssertionError("the gpu probe never answered")


def test_health_ok(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["version"]
    assert isinstance(body["pid"], int)
    assert body["started_at"]


def test_health_omits_gpu_until_the_probe_answers(app, client):
    """The first request only starts the probe: health must not wait for the CUDA stack."""
    blocked = threading.Event()
    app.state.gpu_probe = GpuProbe(probe=lambda: blocked.wait(5) and {"available": True, "name": "X"})
    try:
        assert "gpu" not in client.get("/api/v1/health").json()
    finally:
        blocked.set()


def test_health_reports_the_gpu_once_the_probe_finishes(app, client):
    app.state.gpu_probe = GpuProbe(probe=lambda: {"available": True, "name": "NVIDIA Test GPU"})
    client.get("/api/v1/health")
    assert answered(app.state.gpu_probe) == {"available": True, "name": "NVIDIA Test GPU"}
    assert client.get("/api/v1/health").json()["gpu"] == {"available": True, "name": "NVIDIA Test GPU"}


def test_gpu_probe_runs_the_probe_once():
    calls: list[int] = []
    probe = GpuProbe(probe=lambda: calls.append(1) or {"available": False, "name": None})
    assert probe.snapshot() is None
    assert answered(probe) == {"available": False, "name": None}
    assert probe.snapshot() == {"available": False, "name": None}
    assert calls == [1]


def test_gpu_probe_reports_no_gpu_after_the_timeout_and_still_self_heals():
    """A probe that outlives the timeout must not hold health back; a late answer still wins."""
    blocked = threading.Event()
    now = [0.0]
    probe = GpuProbe(
        probe=lambda: blocked.wait(5) and {"available": True, "name": "Late GPU"},
        timeout_s=10.0,
        clock=lambda: now[0],
    )
    assert probe.snapshot() is None
    now[0] = 9.9
    assert probe.snapshot() is None
    now[0] = 10.0
    assert probe.snapshot() == {"available": False, "name": None}
    blocked.set()
    deadline = time.time() + 5
    while probe.snapshot() != {"available": True, "name": "Late GPU"} and time.time() < deadline:
        time.sleep(0.01)
    assert probe.snapshot() == {"available": True, "name": "Late GPU"}


def test_gpu_probe_reports_no_gpu_when_the_probe_raises():
    def boom() -> dict:
        raise RuntimeError("no cuda here")

    probe = GpuProbe(probe=boom)
    assert answered(probe) == {"available": False, "name": None}


def test_probe_cuda_answers_for_real_on_this_machine():
    """The one place the suite runs the real probe; the app fixture stubs it everywhere else."""
    value = probe_cuda()
    assert set(value) == {"available", "name"}
    assert isinstance(value["available"], bool)
    assert value["name"] is None or isinstance(value["name"], str)
