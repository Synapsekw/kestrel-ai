"""A stand-in design reader for the inspect-phase API tests (Task 4): one 3-point TIN candidate.

HOLD keeps the job running until a test cancels it; FAIL makes it raise a JobFailure. (The
"cancelled between check and write" race against a deleted folder is tested by calling
phase_inspect.run directly with a purpose-built fake reader - see
test_design_api_inspect.py::test_a_late_write_after_cancellation_ends_the_job_cancelled_not_failed
- since delete_design_inspection now waits for a live job to actually stop before it removes the
folder (fix round 2), so a reader driven through the real HTTP/job-runner path no longer gets a
realistic chance at hitting a folder that is gone while it is still marked live.)
"""

from __future__ import annotations

import threading
import time

import numpy as np

from app.jobs.cancellation import JobFailure
from app.surfaces.design import store, thumbs
from app.surfaces.design.inspection import Detected, InspectResult, candidate_from_meta

HOLD = threading.Event()
FAIL: list[str] = []


def inspect_file(path, idir, *, progress, check_cancelled) -> InspectResult:
    while HOLD.is_set():
        check_cancelled()
        time.sleep(0.01)
    if FAIL:
        raise JobFailure(FAIL[0])
    pts = np.array([[500000.0, 2800000.0, 1.0], [500010.0, 2800000.0, 2.0], [500000.0, 2800010.0, 3.0]])
    w = store.CandidateWriter(store.candidate_dir(idir, "c0"), "faces")
    w.add_points(pts)
    w.add_faces([[0, 1, 2]])
    meta = w.close()
    thumbs.plan_thumbnail(pts, store.thumb_path(idir, "c0"))
    progress(1.0, "read")
    return InspectResult(
        detected=Detected("metre", "metre", "fake"),
        candidates=[candidate_from_meta("c0", "tin_surface", "Ground", meta, default_selected=True)],
        internal={"reader": "fake"},
    )
