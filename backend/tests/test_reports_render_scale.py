"""Spec 2026-09-26-reports §18 criterion 4 (plan 2026-09-30-reports-r10, ruling R10-5): a 300-finding
report renders as one `report_render` job within the memory budget of §15.

Deselected by default (a memory and timing measurement under the parallel gate measures the machine);
run on an idle machine: `pytest -m perf tests/test_reports_render_scale.py -s`.
"""

import threading
import time

import psutil
import pytest
from findings_helpers import add_type, use_types

from app.reports import render_job

N_FINDINGS = 300
N_IMAGES = 30
MB = 1 << 20
# §15: one PDF part (PART_BUDGET = 160 MB of embedded JPEG) + reportlab overhead + one decoded image
# (a 12 MP photo decodes to ~36 MB). Measured as the process RSS peak over its pre-render value.
PEAK_BUDGET_MB = 400
STALL_S = 900  # a stall guard, not a budget


@pytest.fixture
def live_render(app, monkeypatch):
    # conftest disables the real pipeline; this measurement needs it (as R5's render-job tests do).
    monkeypatch.setattr(render_job, "run_pipeline", render_job._run_pipeline)


class RssPeak:
    """Samples this process's RSS every 50 ms on a thread while the block runs."""

    def __enter__(self):
        self.proc = psutil.Process()
        self.base = self.peak = self.proc.memory_info().rss
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def _run(self):
        while not self._stop.wait(0.05):
            self.peak = max(self.peak, self.proc.memory_info().rss)

    def __exit__(self, *exc):
        self._stop.set()
        self._thread.join()
        self.peak = max(self.peak, self.proc.memory_info().rss)


@pytest.mark.perf
def test_a_300_finding_report_renders_as_one_job_within_the_memory_budget(
    live_render, client, project, wait_job, import_source, make_jpeg, tmp_path
):
    pid = project["id"]
    crack = add_type(client, "crack", colour="#ff5a4f", default_severity=2)
    use_types(client, project, crack)
    photos = tmp_path / "photos"
    for i in range(N_IMAGES):
        make_jpeg(photos / f"IMG_{i:04d}.jpg", 4000, 3000, seed=i)
    import_source(pid, photos)
    images = client.get(f"/api/v1/projects/{pid}/images", params={"limit": N_IMAGES, "sort": "path"}).json()[
        "items"
    ]
    assert len(images) == N_IMAGES
    per_image = N_FINDINGS // N_IMAGES
    for image in images:
        for k in range(per_image):
            r = client.post(
                f"/api/v1/projects/{pid}/findings",
                json={
                    "type_id": crack["id"],
                    "severity": 1 + k % 4,
                    "anchor": {
                        "kind": "image",
                        "image_id": image["id"],
                        "box": {"x": 200 + 350 * k, "y": 400 + 600 * (k % 3), "w": 180, "h": 90},
                    },
                },
            )
            assert r.status_code == 201, r.text

    created = client.post(
        f"/api/v1/projects/{pid}/reports", json={"title": "Scale", "template_id": "builtin-full"}
    )
    assert created.status_code == 201, created.text
    rid = created.json()["id"]

    with RssPeak() as rss:
        t0 = time.perf_counter()
        r = client.post(
            f"/api/v1/projects/{pid}/reports/{rid}/renders", json={"formats": ["pdf", "csv", "xlsx"]}
        )
        assert r.status_code == 202, r.text
        job = wait_job(pid, r.json()["job"]["id"], timeout=STALL_S)
        elapsed = time.perf_counter() - t0
    assert job["state"] == "succeeded", job

    version = client.get(f"/api/v1/projects/{pid}/reports/{rid}/versions/1").json()
    pdfs = [f for f in version["files"] if f["kind"] == "pdf"]
    pages = sum(f["pages"] for f in pdfs)
    peak_mb = (rss.peak - rss.base) / MB
    print(
        f"300-finding render: {elapsed:.1f} s, {len(pdfs)} PDF part(s), {pages} pages, "
        f"RSS peak +{peak_mb:.0f} MB over {rss.base / MB:.0f} MB, stats {version['stats']}"
    )
    assert pages >= N_FINDINGS  # one page per finding at least
    assert sorted(f["kind"] for f in version["files"]) == sorted(["csv", "xlsx", *(["pdf"] * len(pdfs))])
    assert peak_mb <= PEAK_BUDGET_MB
