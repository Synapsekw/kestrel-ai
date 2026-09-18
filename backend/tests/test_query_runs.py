"""Query runs: estimate, create, the infer job and promotion (spec section 8)."""

import json
import logging
import threading

import pytest

from app.db.models import Box, Image, Job, Model, QueryRun, Source
from app.inference.ratelimit import TokenBucket
from app.jobs.runner import JobContext
from app.providers.base import Detection, ProviderError, TileResult

BASE = "/api/v1/projects"
CLASSES = ["excavator", "dump_truck"]


class FakeProvider:
    """Deterministic detections, one box per tile, with scripted failures and refusals."""

    name = "fake"

    def __init__(
        self,
        *,
        retryable_failures=0,
        permanent_tiles=(),
        refuse_tiles=(),
        label="excavator",
        retry_after=None,
    ):
        self.retryable_left = retryable_failures
        self.retry_after = retry_after
        self.permanent_tiles = set(permanent_tiles)
        self.refuse_tiles = set(refuse_tiles)
        self.label = label
        self.calls: list[int] = []

    def detect_tile(self, image, tile, query, classes, *, conf, log, raw_ref=""):
        self.calls.append(tile.index)
        if tile.index in self.permanent_tiles:
            raise ProviderError("tile is cursed", retryable=False)
        if self.retryable_left:
            self.retryable_left -= 1
            raise ProviderError("busy", retryable=True, retry_after=self.retry_after)
        if tile.index in self.refuse_tiles:
            refusal = {"category": "general_harms", "explanation": "no"}
            return TileResult(tile=tile, detections=[], refusal=refusal)
        det = Detection(
            label=self.label,
            x=tile.x + 10,
            y=tile.y + 10,
            w=50,
            h=40,
            confidence=0.9 if tile.index % 2 == 0 else 0.4,
            raw_ref=raw_ref,
        )
        return TileResult(tile=tile, detections=[det], raw={"fake": True})


@pytest.fixture(autouse=True)
def fresh_buckets():
    """The bucket registry is process state; no test may inherit another test's tokens."""
    from app.inference import ratelimit

    ratelimit.reset_buckets()
    yield
    ratelimit.reset_buckets()


@pytest.fixture
def no_sleep(monkeypatch):
    """Retry backoff waits on the cancellation event; make that wait return at once."""
    monkeypatch.setattr("app.inference.jobs.MAX_RETRY_WAIT_S", 0)


@pytest.fixture
def use_provider(monkeypatch):
    def _use(provider):
        monkeypatch.setattr("app.inference.jobs.get_provider", lambda *a, **k: provider)
        return provider

    return _use


@pytest.fixture
def frames(project_id, project_dir, handle, make_jpeg):
    """Two small frames registered straight in the DB; importing folders is S1's business."""
    ids = []
    with handle.session() as s:
        source = Source(folder=str(project_dir), site="test")
        s.add(source)
        s.flush()
        for i in range(2):
            make_jpeg(project_dir / "images" / f"f{i}.jpg", 2000, 1280, seed=i)
            row = Image(path=f"images/f{i}.jpg", width=2000, height=1280, source_id=source.id)
            s.add(row)
            s.flush()
            ids.append(row.id)
    return ids


@pytest.fixture
def class_ids(project) -> dict:
    return {c["name"]: c["id"] for c in project["classes"]}


@pytest.fixture
def with_key(app):
    app.state.keys.set("anthropic", "sk-fake-key")


def cloud_body(image_ids, **over):
    return {
        "kind": "cloud_provider",
        "provider": "anthropic",
        "query": "dump trucks",
        "image_ids": image_ids,
        **over,
    }


def boxes_of(handle, image_id=None) -> list[Box]:
    from sqlalchemy import select

    with handle.session() as s:
        q = select(Box) if image_id is None else select(Box).where(Box.image_id == image_id)
        rows = list(s.execute(q).scalars())
        for r in rows:
            s.expunge(r)
    return rows


# ------------------------------------------------------------------- estimate


def test_estimate_counts_tiles_and_multiplies_by_the_provider_cost(client, project_id, frames):
    r = client.post(f"{BASE}/{project_id}/query-runs/estimate", json=cloud_body(frames))
    assert r.status_code == 200, r.text
    # 2000x1280 with tile 1280 / overlap 0.2 is two tiles per image.
    assert r.json() == {
        "images": 2,
        "tiles": 4,
        "requests": 4,
        "cost_per_request": 0.02,
        "estimated_cost": pytest.approx(0.08),
    }


def test_estimate_for_the_real_frame_size_matches_the_twelve_tile_grid(client, project_id, handle, frames):
    from sqlalchemy import select

    with handle.session() as s:
        for row in s.execute(select(Image)).scalars():
            row.width, row.height = 4000, 2667
    body = client.post(f"{BASE}/{project_id}/query-runs/estimate", json=cloud_body(frames)).json()
    assert (body["tiles"], body["requests"]) == (24, 24)
    assert body["estimated_cost"] == pytest.approx(0.48)


def test_a_local_run_costs_nothing(client, project_id, handle, frames):
    with handle.session() as s:
        model = Model(name="m", kind="imported", weights_path="models/m.pt", class_names=CLASSES)
        s.add(model)
        s.flush()
        model_id = model.id
    body = {"kind": "local_model", "model_id": model_id, "image_ids": frames}
    estimate = client.post(f"{BASE}/{project_id}/query-runs/estimate", json=body).json()
    assert estimate["cost_per_request"] == 0
    assert estimate["estimated_cost"] == 0


def test_estimate_with_an_unknown_image_is_a_404(client, project_id, frames):
    r = client.post(f"{BASE}/{project_id}/query-runs/estimate", json=cloud_body([frames[0], "nope"]))
    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "not_found"


def test_disabled_tiling_is_one_request_per_image(client, project_id, frames):
    tiling = {"enabled": False, "tile_size": 1280, "overlap": 0.2, "nms_iou": 0.5}
    r = client.post(f"{BASE}/{project_id}/query-runs/estimate", json=cloud_body(frames, tiling=tiling))
    assert r.json()["requests"] == 2


# --------------------------------------------------------------------- create


def test_a_cloud_run_without_a_stored_key_is_a_conflict(client, project_id, frames):
    r = client.post(f"{BASE}/{project_id}/query-runs", json=cloud_body(frames))
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "conflict"
    assert "no API key stored" in r.json()["error"]["message"]


def test_a_cloud_run_without_a_query_is_a_422(client, project_id, frames, with_key):
    r = client.post(f"{BASE}/{project_id}/query-runs", json=cloud_body(frames, query="  "))
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "validation_error"


def test_a_cloud_run_without_a_provider_is_a_422(client, project_id, frames, with_key):
    body = {"kind": "cloud_provider", "query": "x", "image_ids": frames}
    assert client.post(f"{BASE}/{project_id}/query-runs", json=body).status_code == 422


def test_a_local_run_without_a_model_is_a_422(client, project_id, frames):
    body = {"kind": "local_model", "image_ids": frames}
    assert client.post(f"{BASE}/{project_id}/query-runs", json=body).status_code == 422


def test_a_local_run_with_an_unknown_model_is_a_404(client, project_id, frames):
    body = {"kind": "local_model", "model_id": "ghost", "image_ids": frames}
    assert client.post(f"{BASE}/{project_id}/query-runs", json=body).status_code == 404


def test_creating_a_run_returns_the_run_and_its_queued_job(
    client, project_id, frames, with_key, use_provider
):
    use_provider(FakeProvider())
    r = client.post(f"{BASE}/{project_id}/query-runs", json=cloud_body(frames))
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["query_run"]["kind"] == "cloud_provider"
    assert body["query_run"]["provider"] == "anthropic"
    assert body["query_run"]["model_name"] == "claude-opus-5"
    assert body["query_run"]["image_ids"] == frames
    assert body["query_run"]["box_count"] == 0
    assert body["query_run"]["promoted_at"] is None
    assert body["job"]["type"] == "infer"
    assert body["query_run"]["job_id"] == body["job"]["id"]


# ------------------------------------------------------------------ infer job


def run_and_wait(client, wait_job, project_id, frames, **over) -> dict:
    created = client.post(f"{BASE}/{project_id}/query-runs", json=cloud_body(frames, **over)).json()
    job = wait_job(project_id, created["job"]["id"])
    return {"run": created["query_run"], "job": job}


def test_the_job_writes_unreviewed_proposals_with_cloud_provenance(
    client, wait_job, project_id, frames, handle, class_ids, with_key, use_provider, no_sleep
):
    use_provider(FakeProvider())
    out = run_and_wait(client, wait_job, project_id, frames)

    assert out["job"]["state"] == "succeeded", out["job"]
    assert out["job"]["result"] == {
        "query_run_id": out["run"]["id"],
        "images": 2,
        "tiles": 4,
        "boxes": 4,
        "failed_tiles": 0,
        "refusals": 0,
    }
    rows = boxes_of(handle)
    assert len(rows) == 4
    assert {r.provenance_kind for r in rows} == {"cloud_provider"}
    assert {r.provider for r in rows} == {"anthropic"}
    assert {r.model_name for r in rows} == {"claude-opus-5"}
    assert {r.query_run_id for r in rows} == {out["run"]["id"]}
    assert {r.review_state for r in rows} == {"unreviewed"}
    assert {r.class_id for r in rows} == {class_ids["excavator"]}
    assert all(r.model_id is None for r in rows)

    listed = client.get(f"{BASE}/{project_id}/images", params={"has_pending": True}).json()
    assert {i["id"] for i in listed["items"]} == set(frames)
    assert client.get(f"{BASE}/{project_id}/query-runs/{out['run']['id']}").json()["box_count"] == 4


def test_the_job_publishes_boxes_changed_for_every_image(
    client, wait_job, project_id, frames, app, with_key, use_provider, no_sleep
):
    use_provider(FakeProvider())
    seen = []
    app.state.events.publish = lambda event: seen.append(event)
    run_and_wait(client, wait_job, project_id, frames)
    changed = [e for e in seen if e["type"] == "boxes.changed"]
    assert [i for e in changed for i in e["payload"]["image_ids"]] == frames


def test_a_retryable_failure_is_retried_until_it_succeeds(
    client, wait_job, project_id, frames, handle, with_key, use_provider, no_sleep
):
    provider = use_provider(FakeProvider(retryable_failures=2))
    out = run_and_wait(client, wait_job, project_id, frames)
    assert out["job"]["state"] == "succeeded"
    assert out["job"]["result"]["failed_tiles"] == 0
    assert len(provider.calls) == 6  # 4 tiles + 2 retries
    assert len(boxes_of(handle)) == 4


def test_a_permanent_failure_marks_one_tile_failed_and_the_job_still_succeeds(
    client, wait_job, project_id, frames, handle, with_key, use_provider, no_sleep
):
    use_provider(FakeProvider(permanent_tiles=[1]))
    out = run_and_wait(client, wait_job, project_id, frames)
    assert out["job"]["state"] == "succeeded", out["job"]
    assert out["job"]["result"]["failed_tiles"] == 2  # tile index 1 of each image
    assert len(boxes_of(handle)) == 2


def test_refusals_are_counted_and_leave_the_tile_empty(
    client, wait_job, project_id, frames, handle, with_key, use_provider, no_sleep
):
    use_provider(FakeProvider(refuse_tiles=[0]))
    out = run_and_wait(client, wait_job, project_id, frames)
    assert out["job"]["result"]["refusals"] == 2
    assert out["job"]["result"]["failed_tiles"] == 0
    assert len(boxes_of(handle)) == 2


def test_overlapping_detections_are_merged_per_image(
    client, wait_job, project_id, frames, handle, with_key, use_provider, no_sleep
):
    class Overlapping(FakeProvider):
        def detect_tile(self, image, tile, query, classes, *, conf, log, raw_ref=""):
            self.calls.append(tile.index)
            det = Detection(label="excavator", x=800, y=100, w=100, h=100, confidence=0.5 + tile.index / 10)
            return TileResult(tile=tile, detections=[det])

    use_provider(Overlapping())
    out = run_and_wait(client, wait_job, project_id, frames)
    assert out["job"]["result"]["boxes"] == 2  # one per image, the higher confidence kept
    assert {round(r.confidence, 2) for r in boxes_of(handle)} == {0.6}


# ---------------------------------------------------- direct job control tests


@pytest.fixture
def job_context(app, handle):
    """A JobContext bound to a real job row, for driving `run_infer` without the runner pool."""

    def _make(params: dict, job_id: str | None = None) -> JobContext:
        with handle.session() as s:
            if job_id is None:
                job = Job(type="infer", params=params)
                s.add(job)
                s.flush()
                job_id = job.id
        (handle.runs_dir / job_id).mkdir(parents=True, exist_ok=True)
        return JobContext(app.state.jobs, handle, job_id, params, logging.getLogger(f"job.{job_id}"))

    return _make


@pytest.fixture
def cloud_run(handle, frames):
    def _make(**over) -> QueryRun:
        with handle.session() as s:
            row = QueryRun(
                kind="cloud_provider",
                provider="anthropic",
                model_name="claude-opus-5",
                query="dump trucks",
                image_ids=frames,
                tiling={"enabled": True, "tile_size": 1280, "overlap": 0.2, "nms_iou": 0.5},
                conf=0.25,
                **over,
            )
            s.add(row)
            s.flush()
            s.expunge(row)
        return row

    return _make


def test_cancellation_keeps_the_finished_tiles(
    client, handle, cloud_run, job_context, with_key, use_provider, no_sleep
):
    from app.inference.jobs import run_infer
    from app.jobs.runner import JobCancelled

    run = cloud_run()
    ctx = job_context({"query_run_id": run.id})

    provider = FakeProvider()
    original = provider.detect_tile

    def cancel_after_two(*args, **kwargs):
        result = original(*args, **kwargs)
        if len(provider.calls) == 2:
            ctx.cancelled.set()
        return result

    provider.detect_tile = cancel_after_two
    use_provider(provider)

    with pytest.raises(JobCancelled):
        run_infer(ctx)

    # tiles belong to the run, not the job, so a resume can reuse them
    persisted = sorted((handle.runs_dir / "query-runs" / run.id / "tiles").rglob("*.json"))
    assert len(persisted) == 2
    assert json.loads(persisted[0].read_text("utf-8"))["detections"]


def test_a_second_run_in_the_same_job_folder_only_calls_the_missing_tiles(
    client, handle, cloud_run, job_context, with_key, use_provider, no_sleep
):
    from app.inference.jobs import run_infer

    run = cloud_run()
    ctx = job_context({"query_run_id": run.id})
    first = use_provider(FakeProvider(permanent_tiles=[1]))
    run_infer(ctx)
    assert sorted(first.calls) == [0, 0, 1, 1]

    second = use_provider(FakeProvider())
    resumed = job_context({"query_run_id": run.id}, job_id=ctx.job_id)
    result = run_infer(resumed)

    assert second.calls == [1, 1]  # the two tiles that failed, nothing else
    assert result["failed_tiles"] == 0
    assert result["boxes"] == 4
    assert len(boxes_of(handle)) == 4  # the earlier boxes were replaced, not doubled


def test_a_local_run_writes_model_provenance(client, handle, job_context, use_provider, no_sleep, frames):
    from app.inference.jobs import run_infer

    with handle.session() as s:
        model = Model(name="m", kind="imported", weights_path="models/m.pt", class_names=CLASSES)
        s.add(model)
        s.flush()
        model_id = model.id
        run = QueryRun(
            kind="local_model",
            model_id=model_id,
            model_name="m",
            image_ids=frames,
            tiling={"enabled": True, "tile_size": 1280, "overlap": 0.2, "nms_iou": 0.5},
            conf=0.25,
        )
        s.add(run)
        s.flush()
        s.expunge(run)

    use_provider(FakeProvider())
    run_infer(job_context({"query_run_id": run.id}))

    rows = boxes_of(handle)
    assert {r.provenance_kind for r in rows} == {"local_model"}
    assert {r.model_id for r in rows} == {model_id}
    assert all(r.provider is None for r in rows)


# ------------------------------------------------------------ list and promote


def test_runs_are_listed_newest_first(client, project_id, frames, with_key, use_provider):
    use_provider(FakeProvider())
    ids = [
        client.post(f"{BASE}/{project_id}/query-runs", json=cloud_body(frames)).json()["query_run"]["id"]
        for _ in range(3)
    ]
    listed = client.get(f"{BASE}/{project_id}/query-runs", params={"limit": 2}).json()
    assert [i["id"] for i in listed["items"]] == ids[::-1][:2]
    assert listed["next_cursor"]
    rest = client.get(f"{BASE}/{project_id}/query-runs", params={"cursor": listed["next_cursor"]}).json()
    assert [i["id"] for i in rest["items"]] == [ids[0]]


def test_an_unknown_run_is_a_404(client, project_id):
    assert client.get(f"{BASE}/{project_id}/query-runs/ghost").status_code == 404
    assert client.post(f"{BASE}/{project_id}/query-runs/ghost/promote", json={}).status_code == 404


def test_promote_accepts_only_the_confident_boxes(
    client, wait_job, project_id, frames, handle, with_key, use_provider, no_sleep
):
    use_provider(FakeProvider())
    out = run_and_wait(client, wait_job, project_id, frames)
    run_id = out["run"]["id"]

    r = client.post(f"{BASE}/{project_id}/query-runs/{run_id}/promote", json={"min_confidence": 0.5})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accepted"] == 2  # the 0.9 box of each image; the 0.4 boxes stay unreviewed
    assert body["query_run"]["promoted_at"] is not None

    rows = boxes_of(handle)
    assert sorted((r.review_state, round(r.confidence, 1)) for r in rows) == [
        ("accepted", 0.9),
        ("accepted", 0.9),
        ("unreviewed", 0.4),
        ("unreviewed", 0.4),
    ]
    assert all(r.reviewed_at is not None for r in rows if r.review_state == "accepted")


def test_promote_without_a_threshold_accepts_everything_and_is_idempotent(
    client, wait_job, project_id, frames, handle, with_key, use_provider, no_sleep
):
    use_provider(FakeProvider())
    run_id = run_and_wait(client, wait_job, project_id, frames)["run"]["id"]
    assert client.post(f"{BASE}/{project_id}/query-runs/{run_id}/promote", json={}).json()["accepted"] == 4
    assert client.post(f"{BASE}/{project_id}/query-runs/{run_id}/promote", json={}).json()["accepted"] == 0
    assert {r.review_state for r in boxes_of(handle)} == {"accepted"}


# ----------------------------------------------------------------- rate limits


def test_the_token_bucket_lets_a_minutes_worth_through_then_waits():
    clock = {"now": 0.0}
    slept: list[float] = []

    def sleep(seconds):
        slept.append(seconds)
        clock["now"] += seconds

    bucket = TokenBucket(60, monotonic=lambda: clock["now"], sleep=sleep)
    for _ in range(60):
        bucket.acquire()
    assert slept == []

    bucket.acquire()
    assert len(slept) == 1
    assert slept[0] == pytest.approx(1.0, abs=0.01)


def test_the_token_bucket_refills_over_time():
    clock = {"now": 0.0}
    bucket = TokenBucket(60, monotonic=lambda: clock["now"], sleep=lambda s: None)
    for _ in range(60):
        bucket.acquire()
    clock["now"] = 30.0  # half a minute later, half the bucket is back
    for _ in range(30):
        bucket.acquire()
    assert bucket.tokens == pytest.approx(0.0, abs=0.01)


def test_the_job_rate_limits_cloud_calls(
    client, handle, cloud_run, job_context, with_key, use_provider, no_sleep, monkeypatch
):
    from app.inference import jobs, ratelimit

    acquired = []
    monkeypatch.setattr(ratelimit.TokenBucket, "acquire", lambda self: acquired.append(1))
    use_provider(FakeProvider())
    run = cloud_run()
    jobs.run_infer(job_context({"query_run_id": run.id}))
    assert len(acquired) == 4  # one per tile, only for cloud providers


def test_a_local_run_is_not_rate_limited(
    client, handle, job_context, use_provider, no_sleep, frames, monkeypatch
):
    from app.inference import jobs, ratelimit

    acquired = []
    monkeypatch.setattr(ratelimit.TokenBucket, "acquire", lambda self: acquired.append(1))
    with handle.session() as s:
        model = Model(name="m", kind="imported", weights_path="models/m.pt", class_names=CLASSES)
        s.add(model)
        s.flush()
        run = QueryRun(
            kind="local_model",
            model_id=model.id,
            model_name="m",
            image_ids=frames,
            tiling={"enabled": True, "tile_size": 1280, "overlap": 0.2, "nms_iou": 0.5},
            conf=0.25,
        )
        s.add(run)
        s.flush()
        s.expunge(run)

    use_provider(FakeProvider())
    jobs.run_infer(job_context({"query_run_id": run.id}))
    assert acquired == []


def test_the_bucket_is_shared_per_provider_and_follows_the_configured_rate():
    from app.inference.ratelimit import bucket_for

    first = bucket_for("anthropic", 30)
    assert bucket_for("anthropic", 30) is first  # two jobs on one provider share one budget
    assert bucket_for("openai", 30) is not first
    assert bucket_for("anthropic", 120).capacity == 120  # a settings change takes effect at once
    assert first.capacity == 120


def test_a_retry_wait_ends_as_soon_as_the_job_is_cancelled(
    client, handle, cloud_run, job_context, with_key, use_provider
):
    import time

    from app.inference.jobs import run_infer
    from app.jobs.runner import JobCancelled

    run = cloud_run()
    ctx = job_context({"query_run_id": run.id})
    # a retryable failure that asks for an hour: cancelling must not wait for it
    provider = use_provider(FakeProvider(retryable_failures=99, retry_after=3600))
    threading.Timer(0.2, ctx.cancelled.set).start()

    started = time.monotonic()
    with pytest.raises(JobCancelled):
        run_infer(ctx)
    assert time.monotonic() - started < 5
    assert provider.calls  # it got as far as calling the provider


def test_a_cloud_job_without_the_runner_wiring_fails_loudly(
    client, handle, cloud_run, job_context, use_provider, no_sleep, monkeypatch
):
    from app.inference.jobs import run_infer

    ctx = job_context({"query_run_id": cloud_run().id})
    monkeypatch.setattr(ctx.runner, "keys", None, raising=False)
    with pytest.raises(RuntimeError, match="keys"):
        run_infer(ctx)


# --------------------------------------------------------------------- resume


def test_resume_reuses_the_finished_tiles_and_keeps_reviewed_boxes(
    client, wait_job, project_id, frames, handle, with_key, use_provider, no_sleep
):
    from sqlalchemy import select

    provider = use_provider(FakeProvider(permanent_tiles=[1]))
    out = run_and_wait(client, wait_job, project_id, frames)
    run_id = out["run"]["id"]
    assert out["job"]["result"]["failed_tiles"] == 2
    assert sorted(provider.calls) == [0, 0, 1, 1]

    # the user accepts one of the proposals before resuming
    with handle.session() as s:
        keep = s.execute(select(Box).where(Box.query_run_id == run_id)).scalars().first()
        keep.review_state = "accepted"
        keep_id = keep.id

    second = use_provider(FakeProvider())
    r = client.post(f"{BASE}/{project_id}/query-runs/{run_id}/resume")
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])

    assert job["state"] == "succeeded", job
    assert second.calls == [1, 1]  # only the tiles that had failed
    assert job["result"]["failed_tiles"] == 0
    rows = boxes_of(handle)
    kept = next(r for r in rows if r.id == keep_id)  # the accepted box survived the resume
    assert kept.review_state == "accepted"
    assert client.get(f"{BASE}/{project_id}/query-runs/{run_id}").json()["job_id"] == job["id"]


def test_resume_of_a_finished_run_calls_the_provider_for_nothing(
    client, wait_job, project_id, frames, handle, with_key, use_provider, no_sleep
):
    use_provider(FakeProvider())
    run_id = run_and_wait(client, wait_job, project_id, frames)["run"]["id"]
    before = sorted((r.id, r.review_state) for r in boxes_of(handle))

    second = use_provider(FakeProvider())
    r = client.post(f"{BASE}/{project_id}/query-runs/{run_id}/resume")
    job = wait_job(project_id, r.json()["job"]["id"])

    assert job["state"] == "succeeded"
    assert second.calls == []  # every tile came from the run's own tile folder
    assert sorted((r.id, r.review_state) for r in boxes_of(handle)) == before  # boxes untouched


def test_resume_while_the_job_is_still_running_is_a_conflict(
    client, project_id, frames, with_key, use_provider
):
    release = threading.Event()

    class Blocking(FakeProvider):
        def detect_tile(self, image, tile, query, classes, *, conf, log, raw_ref=""):
            release.wait(10)
            return super().detect_tile(image, tile, query, classes, conf=conf, log=log, raw_ref=raw_ref)

    use_provider(Blocking())
    created = client.post(f"{BASE}/{project_id}/query-runs", json=cloud_body(frames)).json()
    run_id = created["query_run"]["id"]
    try:
        r = client.post(f"{BASE}/{project_id}/query-runs/{run_id}/resume")
        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "conflict"
    finally:
        release.set()


def test_resume_of_an_unknown_run_is_a_404(client, project_id):
    assert client.post(f"{BASE}/{project_id}/query-runs/ghost/resume").status_code == 404
