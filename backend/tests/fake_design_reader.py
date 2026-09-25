"""A stand-in design reader for the inspect-phase API tests (Task 4): one 3-point TIN candidate.

HOLD keeps the job running until a test cancels it; FAIL makes it raise a JobFailure. LATE_WRITE
simulates a reader whose last check_cancelled() passed an instant before delete_design_inspection
cancelled the job and removed the folder: while it is set, the HOLD loop stops calling
check_cancelled() (as if that last check had already happened) so the writes below run into the
gone folder instead.
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
LATE_WRITE = threading.Event()


def inspect_file(path, idir, *, progress, check_cancelled) -> InspectResult:
    while HOLD.is_set():
        if not LATE_WRITE.is_set():
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
