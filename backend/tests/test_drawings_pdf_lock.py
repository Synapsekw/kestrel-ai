"""PDFium is not thread-safe: open_pdf holds one process-wide lock for the whole context (task 10b)."""

import threading
import time

from drawings_helpers import write_pdf

from app.drawings import pdf


def test_open_pdf_never_overlaps_across_threads(tmp_path):
    src = write_pdf(tmp_path / "a.pdf", [(200.0, 200.0)])
    state = {"inside": 0, "max": 0}
    guard = threading.Lock()
    barrier = threading.Barrier(3)

    def work():
        barrier.wait()
        with pdf.open_pdf(src) as doc:
            with guard:
                state["inside"] += 1
                state["max"] = max(state["max"], state["inside"])
            time.sleep(0.05)
            assert len(doc) == 1
            with guard:
                state["inside"] -= 1

    threads = [threading.Thread(target=work) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert state["max"] == 1 and state["inside"] == 0


def test_lock_is_reentrant_and_released_on_error(tmp_path):
    src = write_pdf(tmp_path / "a.pdf", [(200.0, 200.0)])
    with pdf.open_pdf(src), pdf.open_pdf(src):  # nested in one thread must not deadlock
        pass
    try:
        with pdf.open_pdf(src):
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    done = []

    def again():
        with pdf.open_pdf(src):
            done.append(1)

    t = threading.Thread(target=again)  # a leaked lock would hang here
    t.start()
    t.join(5)
    assert done == [1]
