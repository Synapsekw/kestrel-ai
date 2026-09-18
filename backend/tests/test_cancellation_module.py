"""JobCancelled lives in its own leaf module so the GPU lock can import it at module scope."""

import importlib


def test_job_cancelled_has_a_leaf_home_shared_by_runner_and_gpu():
    cancellation = importlib.import_module("app.jobs.cancellation")
    runner = importlib.import_module("app.jobs.runner")
    gpu = importlib.import_module("app.jobs.gpu")

    assert runner.JobCancelled is cancellation.JobCancelled
    assert gpu.JobCancelled is cancellation.JobCancelled  # module-scope import, no late lookup
    assert not hasattr(gpu, "_cancelled_error")
